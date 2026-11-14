//! Headless CLI 入口：子命令 `frame` / `batch` / `project-info`。
//!
//! 用法：
//! - `ocx-cli frame --profile <json文件> --params <json文件> --frame-index N --time-ticks T --duration-ticks D --out <目录> [--name 前缀]`
//! - `ocx-cli batch --profile <json文件> --params <json文件> --count N --duration-ticks D --out <目录> [--name 前缀]`
//! - `ocx-cli project-info --project <经典版项目JSON文件>`
//!
//! 结果一律以一行 JSON 打印到 stdout；失败打印中文错误并以非零码退出。

use std::process::ExitCode;

use ocx_cli::{
    parse_json, parse_params, parse_profile, project_info, render_batch_to_ppm, render_one_to_ppm,
};

const HELP: &str = "ocx-cli 子命令：
  frame        渲染单帧为 PPM（--profile --params --frame-index --time-ticks --duration-ticks --out [--name]）
  batch        批量渲染多帧为 PPM（--profile --params --count --duration-ticks --out [--name]）
  project-info 输出经典版项目结构摘要（--project）";

/** 读取 `--key value` 形式的参数。 */
fn flag(args: &[String], key: &str) -> Option<String> {
    args.iter()
        .position(|item| item == key)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

/** 读取 JSON 文件。 */
fn read_json_file(path: &str, label: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| format!("读取{label}失败：{error}"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(stdout) => {
            println!("{stdout}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<String, String> {
    let Some(command) = args.first() else {
        return Err(format!(
            "用法：ocx-cli <frame|batch|project-info> ...\n{HELP}"
        ));
    };
    match command.as_str() {
        "frame" => run_frame(&args[1..]),
        "batch" => run_batch(&args[1..]),
        "project-info" => run_project_info(&args[1..]),
        "help" | "--help" | "-h" => Ok(HELP.to_owned()),
        other => Err(format!(
            "未知子命令：{other}；可用：frame / batch / project-info"
        )),
    }
}

fn run_frame(args: &[String]) -> Result<String, String> {
    let profile_text = read_json_file(
        &flag(args, "--profile").ok_or("缺少 --profile")?,
        "导出配置",
    )?;
    let params_text = read_json_file(&flag(args, "--params").ok_or("缺少 --params")?, "帧参数")?;
    let frame_index: u64 = flag(args, "--frame-index")
        .ok_or("缺少 --frame-index")?
        .parse()
        .map_err(|_| "--frame-index 必须是非负整数".to_owned())?;
    let time_ticks: i64 = flag(args, "--time-ticks")
        .ok_or("缺少 --time-ticks")?
        .parse()
        .map_err(|_| "--time-ticks 必须是整数".to_owned())?;
    let duration_ticks: i64 = flag(args, "--duration-ticks")
        .ok_or("缺少 --duration-ticks")?
        .parse()
        .map_err(|_| "--duration-ticks 必须是整数".to_owned())?;
    let out = flag(args, "--out").ok_or("缺少 --out")?;
    let base = flag(args, "--name").unwrap_or_else(|| "frame".to_owned());
    let summary = render_one_to_ppm(
        frame_index,
        time_ticks,
        duration_ticks,
        &parse_profile(&profile_text)?,
        &parse_params(&params_text)?,
        std::path::Path::new(&out),
        &base,
    )?;
    serde_json::to_string(&summary).map_err(|error| format!("序列化结果失败：{error}"))
}

fn run_batch(args: &[String]) -> Result<String, String> {
    let profile_text = read_json_file(
        &flag(args, "--profile").ok_or("缺少 --profile")?,
        "导出配置",
    )?;
    let params_text = read_json_file(&flag(args, "--params").ok_or("缺少 --params")?, "帧参数")?;
    let count: u64 = flag(args, "--count")
        .ok_or("缺少 --count")?
        .parse()
        .map_err(|_| "--count 必须是非负整数".to_owned())?;
    let duration_ticks: i64 = flag(args, "--duration-ticks")
        .ok_or("缺少 --duration-ticks")?
        .parse()
        .map_err(|_| "--duration-ticks 必须是整数".to_owned())?;
    let out = flag(args, "--out").ok_or("缺少 --out")?;
    let base = flag(args, "--name").unwrap_or_else(|| "frame".to_owned());
    let summaries = render_batch_to_ppm(
        count,
        duration_ticks,
        &parse_profile(&profile_text)?,
        &parse_params(&params_text)?,
        std::path::Path::new(&out),
        &base,
    )?;
    serde_json::to_string(&summaries).map_err(|error| format!("序列化结果失败：{error}"))
}

fn run_project_info(args: &[String]) -> Result<String, String> {
    let project_text = read_json_file(
        &flag(args, "--project").ok_or("缺少 --project")?,
        "经典版项目",
    )?;
    parse_json(&project_text)?;
    let info = project_info(&project_text)?;
    serde_json::to_string(&info).map_err(|error| format!("序列化结果失败：{error}"))
}
