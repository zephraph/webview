use actson::feeder::BufReaderJsonFeeder;
use actson::options::JsonParserOptionsBuilder;
use actson::{JsonEvent, JsonParser};
use std::env;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

fn should_add_comma(json_string: &str) -> bool {
    !json_string.ends_with('{') && !json_string.ends_with('[') && !json_string.ends_with(':')
}

fn append_value(json_string: &mut String, value: &str) {
    if should_add_comma(json_string) {
        json_string.push(',');
    }
    json_string.push_str(value);
}

fn process_and_forward_json<R: Read + Send + 'static>(
    reader: BufReader<R>,
    output_file: Option<String>,
    forward_to: Sender<String>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let feeder = BufReaderJsonFeeder::new(reader);
        let mut parser = JsonParser::new_with_options(
            feeder,
            JsonParserOptionsBuilder::default()
                .with_streaming(true)
                .build(),
        );

        let mut json_string = String::new();
        let mut depth = 0;

        while let Some(event) = parser.next_event().unwrap_or(None) {
            match event {
                JsonEvent::NeedMoreInput => {
                    if parser.feeder.fill_buf().is_err() {
                        break;
                    }
                }
                JsonEvent::StartObject => {
                    depth += 1;
                    json_string.push('{');
                }
                JsonEvent::EndObject => {
                    depth -= 1;
                    json_string.push('}');

                    if depth == 0 {
                        if forward_to.send(json_string.clone()).is_err() {
                            break;
                        }

                        if let Some(file_path) = &output_file {
                            if let Ok(mut file) =
                                File::options().create(true).append(true).open(file_path)
                            {
                                let _ = writeln!(file, "{}", json_string);
                            }
                        }

                        json_string.clear();
                    }
                }
                JsonEvent::StartArray => {
                    depth += 1;
                    json_string.push('[');
                }
                JsonEvent::EndArray => {
                    depth -= 1;
                    json_string.push(']');
                }
                JsonEvent::FieldName => {
                    if json_string.ends_with('{') {
                        json_string.push('"');
                    } else {
                        json_string.push_str(",\"");
                    }
                    json_string.push_str(parser.current_str().unwrap_or_default());
                    json_string.push_str("\":");
                }
                JsonEvent::ValueString => {
                    append_value(
                        &mut json_string,
                        &format!("\"{}\"", parser.current_str().unwrap_or_default()),
                    );
                }
                JsonEvent::ValueInt => {
                    append_value(
                        &mut json_string,
                        &parser.current_int::<i64>().unwrap_or_default().to_string(),
                    );
                }
                JsonEvent::ValueFloat => {
                    append_value(
                        &mut json_string,
                        &parser.current_float().unwrap_or_default().to_string(),
                    );
                }
                JsonEvent::ValueTrue => append_value(&mut json_string, "true"),
                JsonEvent::ValueFalse => append_value(&mut json_string, "false"),
                JsonEvent::ValueNull => append_value(&mut json_string, "null"),
            }
        }
    })
}

fn forward_to_writer<W: Write + Send + 'static>(
    writer: W,
    receiver: mpsc::Receiver<String>,
    done: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut writer = BufWriter::new(writer);
        while !done.load(Ordering::SeqCst) {
            if let Ok(json) = receiver.recv() {
                if writeln!(writer, "{}", json).is_err() || writer.flush().is_err() {
                    break;
                }
            } else {
                break;
            }
        }
    })
}

fn main() -> io::Result<()> {
    let proxy_to = env::var("PROXY_TO").expect("PROXY_TO environment variable must be set");
    let output_file =
        env::var("OUTPUT_FILE").expect("OUTPUT_FILE environment variable must be set");

    File::create(&output_file)?;

    let shell = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let mut child = Command::new(shell.0)
        .arg(shell.1)
        .arg(&proxy_to)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let done_stdin = Arc::new(AtomicBool::new(false));
    let done_stdout = Arc::new(AtomicBool::new(false));

    let (tx_stdin, rx_stdin) = mpsc::channel();
    let child_stdin = child.stdin.take().unwrap();
    let _stdin_thread = forward_to_writer(child_stdin, rx_stdin, done_stdin.clone());

    let (tx_stdout, rx_stdout) = mpsc::channel();
    let stdout = io::stdout();
    let _stdout_thread = forward_to_writer(stdout, rx_stdout, done_stdout.clone());

    let stdin_reader = BufReader::new(io::stdin());
    let _stdin_process = process_and_forward_json(stdin_reader, Some(output_file), tx_stdin);

    let child_stdout = child.stdout.take().unwrap();
    let stdout_reader = BufReader::new(child_stdout);
    let _stdout_process = process_and_forward_json(stdout_reader, None, tx_stdout);

    child.wait()?;

    Ok(())
}
