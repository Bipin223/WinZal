//! Read text from documents and spreadsheets for Ask/Shelf.

use std::io::Read;
use std::path::Path;

pub const DOC_IN: &[&str] = &["txt", "md", "markdown", "html", "htm", "pdf", "docx"];
pub const TABLE_IN: &[&str] = &["xlsx", "xlsm", "xls", "ods", "csv", "tsv"];

/// Parsed content: Markdown keeps headings/lists, text is just lines.
enum Source {
    Plain(String),
    Markdown(String),
}

/// Plain text for Ask AI: documents and spreadsheets only. Images use
/// `file_preview` instead; media files can't be read as text.
pub fn read_text(path: &str) -> Result<String, String> {
    let input = Path::new(path);
    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if DOC_IN.contains(&ext.as_str()) {
        let source = read_document(input, &ext)?;
        let text = match source {
            Source::Plain(text) => text,
            Source::Markdown(markdown) => markdown,
        };
        return Ok(text.chars().take(120_000).collect());
    }
    if TABLE_IN.contains(&ext.as_str()) {
        let rows = read_table(input, &ext)?;
        let text = rows.iter().map(|row| row.join("\t")).collect::<Vec<_>>().join("\n");
        return Ok(text.chars().take(120_000).collect());
    }
    Err("Format kann nicht als Text gelesen werden".into())
}

// ── Reading ──────────────────────────────────────────────────────────────────

fn read_document(input: &Path, ext: &str) -> Result<Source, String> {
    let text = || {
        let bytes = std::fs::read(input).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
        Ok::<_, String>(String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).into_owned())
    };
    Ok(match ext {
        "txt" => Source::Plain(text()?),
        "md" | "markdown" => Source::Markdown(text()?),
        "html" | "htm" => Source::Markdown(html_to_markdown(&text()?)),
        "pdf" => Source::Plain(tidy_pdf_text(&pdf_extract::extract_text(input).map_err(|_| "PDF-Text nicht lesbar (evtl. nur Bilder/Scan)".to_string())?)),
        "docx" => Source::Markdown(docx_to_markdown(input)?),
        _ => return Err("Format wird nicht unterstützt".into()),
    })
}

/// pdf-extract emits lots of blank lines; collapse them to at most one.
fn tidy_pdf_text(s: &str) -> String {
    let mut out = String::new();
    let mut blank = 0;
    for line in s.lines().map(str::trim_end) {
        if line.trim().is_empty() {
            blank += 1;
            if blank == 1 && !out.is_empty() {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(line);
            out.push('\n');
        }
    }
    out.trim().to_string() + "\n"
}

/// Paragraphs from word/document.xml; headings and lists become Markdown.
fn docx_to_markdown(input: &Path) -> Result<String, String> {
    use quick_xml::events::Event as X;
    let file = std::fs::File::open(input).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Keine gültige DOCX-Datei".to_string())?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "Keine gültige DOCX-Datei".to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;

    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut out = String::new();
    let (mut para, mut heading, mut list, mut in_text) = (String::new(), 0usize, false, false);
    loop {
        match reader.read_event() {
            Ok(X::Start(e)) | Ok(X::Empty(e)) => match AsRef::<str>::as_ref(&e.local_name()) {
                "p" => (para, heading, list) = (String::new(), 0, false),
                "t" => in_text = true,
                "tab" => para.push('\t'),
                "br" => para.push('\n'),
                "numPr" => list = true,
                "pStyle" => {
                    if let Some(v) = e.attributes().flatten().find(|a| AsRef::<str>::as_ref(&a.key.local_name()) == "val") {
                        let v = v.value.to_lowercase();
                        // "Heading1", "berschrift1" (German Word), "Title".
                        if v.starts_with("heading") || v.contains("berschrift") {
                            heading = v.chars().filter(char::is_ascii_digit).collect::<String>().parse().unwrap_or(1).clamp(1, 6);
                        } else if v == "title" {
                            heading = 1;
                        }
                    }
                }
                _ => {}
            },
            Ok(X::Text(t)) if in_text => para.push_str(&t.xml_content(quick_xml::XmlVersion::Implicit1_0)),
            Ok(X::GeneralRef(r)) if in_text => {
                para.push_str(match AsRef::<str>::as_ref(&r) {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    "apos" => "'",
                    _ => "",
                });
            }
            Ok(X::End(e)) => match AsRef::<str>::as_ref(&e.local_name()) {
                "t" => in_text = false,
                "p" => {
                    let text = para.trim();
                    let is_list = (list || text.starts_with("• ")) && !text.is_empty();
                    // Blank line after a list before the next non-list paragraph.
                    if !is_list && out.ends_with('\n') && !out.ends_with("\n\n") {
                        out.push('\n');
                    }
                    if heading > 0 && !text.is_empty() {
                        out.push_str(&format!("{} {text}\n\n", "#".repeat(heading)));
                    } else if is_list {
                        out.push_str(&format!("- {}\n", text.trim_start_matches("• ")));
                    } else if !text.is_empty() {
                        out.push_str(text);
                        out.push_str("\n\n");
                    }
                }
                _ => {}
            },
            Ok(X::Eof) => break,
            Err(_) => return Err("DOCX-Inhalt nicht lesbar".into()),
            _ => {}
        }
    }
    Ok(out.trim_end().to_string() + "\n")
}

/// Rough HTML → Markdown (headings, paragraphs, lists, line breaks).
fn html_to_markdown(html: &str) -> String {
    let body = html.find("<body").and_then(|i| html[i..].find('>').map(|j| &html[i + j + 1..])).unwrap_or(html);
    let mut out = String::new();
    let mut rest = body;
    let mut skip = false;
    while let Some(lt) = rest.find('<') {
        if !skip {
            out.push_str(&decode_entities(&collapse_spaces(&rest[..lt])));
        }
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = rest[lt + 1..lt + gt].trim().to_lowercase();
        rest = &rest[lt + gt + 1..];
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        let closing = tag.starts_with('/');
        match name.as_str() {
            "script" | "style" | "head" => skip = !closing,
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" if !closing => {
                out.push_str("\n\n");
                out.push_str(&"#".repeat(name[1..].parse().unwrap_or(1)));
                out.push(' ');
            }
            "li" if !closing => out.push_str("\n- "),
            "br" => out.push('\n'),
            "p" | "div" | "section" | "article" | "ul" | "ol" | "table" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => out.push_str("\n\n"),
            "td" | "th" if closing => out.push_str(" | "),
            _ => {}
        }
    }
    if !skip {
        out.push_str(&decode_entities(rest));
    }
    // Collapse blank lines, trim lines.
    let mut tidy = String::new();
    for line in out.lines().map(str::trim) {
        if line.is_empty() && (tidy.is_empty() || tidy.ends_with("\n\n")) {
            continue;
        }
        tidy.push_str(line);
        tidy.push('\n');
    }
    tidy.trim().to_string() + "\n"
}

/// Collapses whitespace to one space but keeps the edges ("A <b>paragraph</b>").
fn collapse_spaces(s: &str) -> String {
    let mut out = String::new();
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            space = true;
        } else {
            if space {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    if space {
        out.push(' ');
    }
    out
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

fn read_table(input: &Path, ext: &str) -> Result<Vec<Vec<String>>, String> {
    use calamine::Reader;
    if ext == "csv" || ext == "tsv" {
        let bytes = std::fs::read(input).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
        let text = String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).into_owned();
        // Guess the delimiter: the most common one in the first line (German Excel uses ";").
        let first = text.lines().next().unwrap_or("");
        let delimiter = if ext == "tsv" { b'\t' } else { [b';', b',', b'\t'].into_iter().max_by_key(|d| first.matches(*d as char).count()).unwrap_or(b',') };
        let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).has_headers(false).flexible(true).from_reader(text.as_bytes());
        return reader
            .records()
            .map(|r| r.map(|rec| rec.iter().map(str::to_string).collect()).map_err(|_| "CSV nicht lesbar".to_string()))
            .collect();
    }
    let mut book = calamine::open_workbook_auto(input).map_err(|_| "Tabelle nicht lesbar".to_string())?;
    let range = book.worksheet_range_at(0).ok_or("Tabelle hat kein Blatt")?.map_err(|_| "Tabelle nicht lesbar".to_string())?;
    Ok(range.rows().map(|row| row.iter().map(cell_text).collect()).collect())
}

fn cell_text(c: &calamine::Data) -> String {
    use calamine::{Data, DataType};
    match c {
        Data::Empty => String::new(),
        // Dates as 2026-10-05 (with time if present), not as Excel serial numbers.
        Data::DateTime(_) => c
            .as_datetime()
            .map(|d| d.to_string().trim_end_matches(" 00:00:00").to_string())
            .unwrap_or_else(|| c.to_string()),
        _ => c.to_string(),
    }
}

