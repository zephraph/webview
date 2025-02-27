use schemars::schema_for;
use std::fs::File;
use std::io::Write;
use webview::{Message, Options, Request, Response};

fn main() {
    let schemas = [
        ("WebViewOptions", schema_for!(Options)),
        ("WebViewMessage", schema_for!(Message)),
        ("WebViewRequest", schema_for!(Request)),
        ("WebViewResponse", schema_for!(Response)),
    ];

    for (name, schema) in schemas {
        let schema_json = serde_json::to_string_pretty(&schema).unwrap();
        let mut file = File::create(format!("schemas/{}.json", name)).unwrap();
        file.write_all(schema_json.as_bytes()).unwrap();
        println!("Generated schema for {}", name);
    }
}
