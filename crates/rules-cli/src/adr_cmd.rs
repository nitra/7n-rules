//! Native-команда `adr-normalize-local` — порт CLI-обгортки
//! `npm/scripts/lib/adr/normalize-cli.mjs` поверх `rules-adr`.
//!
//! Контракт незмінний: bash (`normalize-decisions.sh`) готує батч і
//! clean-список файлами, викликає команду, парсить зі stdout
//! `{"operations": [...]}` і застосовує сам; прогрес — у stderr (потрапляє в
//! normalize-decisions.log).
//!
//! Аргументи: `--batch <file>` (обов'язковий), `--clean <file>`,
//! `--adr-dir <dir>` (дефолт `cwd/docs/adr`). ENV:
//! `ADR_NORMALIZE_ALLOW_CLOUD=1`, `ADR_NORMALIZE_VOTES=N` (дефолт 2).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use rules_adr::pipeline::{normalize_pipeline, Draft, PipelineOpts};

/// Парсить `--key value`-пари — порт `parseArgs`.
fn parse_args(argv: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut i = 0;
    while i < argv.len() {
        if let Some(key) = argv[i].strip_prefix("--") {
            if let Some(value) = argv.get(i + 1) {
                out.insert(key.to_string(), value.clone());
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn read_lines(file: &str) -> Result<Vec<String>, String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("не читається {file}: {e}"))?;
    Ok(text
        .split('\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect())
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Точка входу субкоманди — порт `runAdrNormalizeLocalCli`.
pub fn run(argv: &[String]) -> ExitCode {
    let args = parse_args(argv);
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let adr_dir = args
        .get("adr-dir")
        .map(PathBuf::from)
        .unwrap_or_else(|| cwd.join("docs/adr"));
    let Some(batch) = args.get("batch") else {
        eprintln!(
            "Usage: n-rules adr-normalize-local --batch <file> [--clean <file>] [--adr-dir <dir>]"
        );
        return ExitCode::FAILURE;
    };

    let batch_paths = match read_lines(batch) {
        Ok(paths) => paths,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::FAILURE;
        }
    };
    let mut drafts = Vec::with_capacity(batch_paths.len());
    for p in &batch_paths {
        let abs = if Path::new(p).is_absolute() {
            PathBuf::from(p)
        } else {
            adr_dir.join(p)
        };
        match std::fs::read_to_string(&abs) {
            Ok(body) => drafts.push(Draft {
                file: basename(p),
                body,
            }),
            Err(e) => {
                eprintln!("❌ чернетка не читається {}: {e}", abs.display());
                return ExitCode::FAILURE;
            }
        }
    }
    let clean_list: Vec<String> = match args.get("clean") {
        Some(file) => match read_lines(file) {
            Ok(lines) => lines.iter().map(|c| basename(c)).collect(),
            Err(message) => {
                eprintln!("❌ {message}");
                return ExitCode::FAILURE;
            }
        },
        None => Vec::new(),
    };

    let allow_cloud = std::env::var("ADR_NORMALIZE_ALLOW_CLOUD").as_deref() == Ok("1");
    let votes = std::env::var("ADR_NORMALIZE_VOTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(2);
    let (tier1, tier2) = rules_adr::resolve_tiers();

    let opts = PipelineOpts {
        allow_cloud,
        votes,
        tier1,
        tier2,
        submit: rules_adr::native_submit_batch(),
        on_progress: Box::new(|m| eprintln!("adr-normalize-local: {m}")),
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("❌ не вдалося створити async-рантайм: {e}");
            return ExitCode::FAILURE;
        }
    };
    let out = runtime.block_on(normalize_pipeline(&drafts, &clean_list, &opts));

    eprintln!(
        "adr-normalize-local: {} операцій, stats={}",
        out.operations.len(),
        serde_json::json!({
            "localCalls": out.stats.local_calls,
            "cloudCalls": out.stats.cloud_calls,
            "escalations": out.stats.escalations,
            "failures": out.stats.failures,
            "madrInvalid": out.stats.madr_invalid,
        })
    );
    eprintln!(
        "adr-normalize-local: decisions={}",
        serde_json::to_string(&out.trace.decisions).unwrap_or_default()
    );
    print!("{}", serde_json::json!({ "operations": out.operations }));
    ExitCode::SUCCESS
}
