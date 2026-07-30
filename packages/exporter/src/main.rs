use hyper::service::service_fn;
use hyper_staticfile::Static;
use hyper_util::rt::TokioIo;
use std::path::Path;
use std::path::PathBuf;
use tokio::net::TcpListener;

mod setup;

#[macro_use]
extern crate lazy_static;

static FACTORIO_VERSION: &str = "2.0.68";

lazy_static! {
    static ref DATA_DIR: PathBuf = PathBuf::from("./data");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok(); // .ok() so missing .env file is not fatal

    let output_dir = DATA_DIR.join("output");

    if let Ok(factorio_dir_str) = std::env::var("FACTORIO_DIR") {
        let factorio_dir = std::path::PathBuf::from(&factorio_dir_str);
        setup::validate_local_install(&factorio_dir)?;
        setup::extract_local(&output_dir, &factorio_dir).await?;
    } else {
        let factorio_dir_name = match std::env::consts::OS {
            "linux" => "factorio",
            "windows" => &format!("Factorio_{FACTORIO_VERSION}"),
            _ => panic!("unsupported OS - set FACTORIO_DIR to use a local Factorio installation"),
        };
        let base_factorio_dir = DATA_DIR.join(factorio_dir_name);
        setup::download_factorio(&DATA_DIR, &base_factorio_dir, FACTORIO_VERSION).await?;
        setup::extract(&output_dir, &base_factorio_dir).await?;
    }

    let static_ = Static::new(Path::new("data/output/"));
    let listener = TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], 8081))).await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let static_ = static_.clone();
        tokio::spawn(async move {
            if let Err(err) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(|req| static_.clone().serve(req)))
                .await
            {
                eprintln!("Error serving connection: {}", err);
            }
        });
    }
}
