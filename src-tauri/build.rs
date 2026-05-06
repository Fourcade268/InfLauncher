use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let out_dir = env::var("OUT_DIR").unwrap();
    
    // We want to copy to the target/debug or target/release folder
    // OUT_DIR is usually something like target/debug/build/app-xxxx/out
    let dest_path = Path::new(&out_dir)
        .parent().unwrap() // app-xxxx
        .parent().unwrap() // build
        .parent().unwrap() // debug or release
        .to_path_buf();

    let files = ["steam_api64.dll", "steam_appid.txt"];
    
    for file in &files {
        let src = Path::new(file);
        if src.exists() {
            let dest = dest_path.join(file);
            let _ = fs::copy(src, dest);
            println!("cargo:rerun-if-changed={}", file);
        }
    }

    tauri_build::build()
}
