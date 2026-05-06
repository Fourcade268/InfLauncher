use serde::{Serialize, Deserialize};
use steamworks::{Client, AppId, SingleClient};
use std::sync::{Arc, Mutex};
use tauri::{State, Manager, Emitter};
use futures::future::join_all;
use std::net::SocketAddr;
use a2s::A2SClient;
use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerMod {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerInfo {
    pub name: String,
    pub map: String,
    pub players: u32,
    pub max_players: u32,
    pub ping: u64,
    pub ip: String,
    pub port: u16,
    pub mods: Vec<ServerMod>,
    pub is_online: bool,
    pub custom_status: Option<String>,
    pub is_locked: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub preview_url: Option<String>,
    pub size: u64,
    pub is_installed: bool,
    pub is_subscribed: bool,
    pub is_updating: bool,
    pub download_progress: Option<f64>,
    pub download_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SteamUser {
    pub steam_id: String,
    pub persona_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub queryport: u16,
    pub mods: Option<Vec<String>>,
    #[serde(rename = "Status")]
    pub status: Option<String>,
    #[serde(rename = "Locked")]
    pub locked: Option<i32>,
}

#[derive(Deserialize, Clone)]
pub struct ServersJson {
    #[serde(rename = "DirectIP")]
    pub direct_ip: String,
    #[serde(rename = "Servers")]
    pub servers: Vec<ServerConfig>,
}

pub struct SteamState {
    pub client: Arc<Mutex<Option<Client>>>,
    pub single: Arc<Mutex<Option<SingleClient>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerCache {
    pub servers: HashMap<String, CachedServerData>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CachedServerData {
    pub name: String,
    pub map: String,
    pub mods: Vec<ServerMod>,
}

const CACHE_FILE: &str = "cache.dat";
const XOR_KEY: u8 = 0x5A; // Simple key for "obfuscation"

fn get_cache_path(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    app_handle.path().app_data_dir().unwrap_or_default().join(CACHE_FILE)
}

fn save_cache(app_handle: &tauri::AppHandle, cache: &ServerCache) {
    let path = get_cache_path(app_handle);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    
    if let Ok(encoded) = bincode::serialize(cache) {
        let obfuscated: Vec<u8> = encoded.into_iter().map(|b| b ^ XOR_KEY).collect();
        let _ = std::fs::write(path, obfuscated);
    }
}

fn load_cache(app_handle: &tauri::AppHandle) -> ServerCache {
    let path = get_cache_path(app_handle);
    if let Ok(obfuscated) = std::fs::read(path) {
        let deobfuscated: Vec<u8> = obfuscated.into_iter().map(|b| b ^ XOR_KEY).collect();
        if let Ok(cache) = bincode::deserialize::<ServerCache>(&deobfuscated) {
            return cache;
        }
    }
    ServerCache { servers: HashMap::new() }
}

#[tauri::command]
fn get_steam_user(state: State<'_, SteamState>) -> Result<SteamUser, String> {
    let client_lock = state.client.lock().map_err(|e| e.to_string())?;
    
    if let Some(client) = client_lock.as_ref() {
        let steam_id = client.user().steam_id();
        let persona_name = client.friends().get_friend(steam_id).name();
        
        Ok(SteamUser {
            steam_id: steam_id.raw().to_string(),
            persona_name,
            avatar_url: None,
        })
    } else {
        Err("Steam is not running or not initialized".to_string())
    }
}

#[tauri::command]
async fn get_steam_avatar(steam_id: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;
        
    let url = format!("https://steamcommunity.com/profiles/{}?xml=1", steam_id);
    let xml = client.get(&url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    
    if let Some(start) = xml.find("<avatarMedium>") {
        if let Some(end) = xml[start..].find("</avatarMedium>") {
            let mut content = &xml[start + 14 .. start + end];
            if content.starts_with("<![CDATA[") && content.ends_with("]]>") {
                content = &content[9 .. content.len() - 3];
            }
            return Ok(content.to_string());
        }
    }
    
    Err("Avatar not found".into())
}

#[tauri::command]
async fn query_servers(
    app_handle: tauri::AppHandle,
    server_list_url: String, 
    override_ip: Option<String>
) -> Result<Vec<ServerInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response_json: serde_json::Value = client
        .get(&server_list_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch server list: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let json: ServersJson = serde_json::from_value(response_json)
        .map_err(|e| format!("Failed to parse servers JSON: {}", e))?;

    let direct_ip = override_ip.unwrap_or(json.direct_ip);
    let configs = json.servers;

    let mut cache = load_cache(&app_handle);
    let mut query_tasks = Vec::new();

    for config in configs {
        let ip_str = direct_ip.clone();
        let port = config.port;
        let queryport = config.queryport;
        let config_mods = config.mods.clone().unwrap_or_default();
        let custom_status = config.status.clone();
        let is_locked = config.locked.unwrap_or(0) == 1;
        
        query_tasks.push(tokio::task::spawn_blocking(move || {
            let addr: SocketAddr = format!("{}:{}", ip_str, queryport).parse().ok()?;
            let a2s_client = A2SClient::new().ok()?;
            
            match a2s_client.info(addr) {
                Ok(info) => {
                    let mut final_mods = Vec::new();
                    for cm in config_mods {
                        final_mods.push(ServerMod { id: cm.clone(), name: format!("Mod #{}", cm) });
                    }
                    
                    Some(ServerInfo {
                        name: info.name,
                        map: info.map,
                        players: info.players as u32,
                        max_players: info.max_players as u32,
                        ping: 0,
                        ip: ip_str,
                        port: port,
                        mods: final_mods,
                        is_online: true,
                        custom_status,
                        is_locked,
                    })
                }
                Err(_) => {
                    let mut final_mods = Vec::new();
                    for cm in config_mods {
                        final_mods.push(ServerMod { id: cm.clone(), name: format!("Mod #{}", cm) });
                    }
                    Some(ServerInfo {
                        name: "OFFLINE".to_string(),
                        map: "—".to_string(),
                        players: 0,
                        max_players: 0,
                        ping: 0,
                        ip: ip_str,
                        port: port,
                        mods: final_mods,
                        is_online: false,
                        custom_status,
                        is_locked,
                    })
                }
            }
        }));
    }

    let results = join_all(query_tasks).await;
    let mut servers: Vec<ServerInfo> = Vec::new();
    let mut cache_updated = false;

    for res in results {
        if let Ok(Some(mut server)) = res {
            let cache_key = format!("{}:{}", server.ip, server.port);
            if server.is_online {
                cache.servers.insert(cache_key, CachedServerData {
                    name: server.name.clone(),
                    map: server.map.clone(),
                    mods: server.mods.clone(),
                });
                cache_updated = true;
            } else {
                if let Some(cached) = cache.servers.get(&cache_key) {
                    server.name = cached.name.clone();
                    server.map = cached.map.clone();
                    server.mods = cached.mods.clone();
                }
            }
            servers.push(server);
        }
    }

    if cache_updated {
        save_cache(&app_handle, &cache);
    }

    Ok(servers)
}

#[tauri::command]
async fn get_server_mods(state: State<'_, SteamState>, mod_ids: Vec<String>) -> Result<Vec<ModInfo>, String> {
    let mut install_infos = std::collections::HashMap::new();
    let mut subscription_states = std::collections::HashMap::new();
    let mut download_infos = std::collections::HashMap::new();
    {
        let client_lock = state.client.lock().map_err(|e| e.to_string())?;
        let client = client_lock.as_ref().ok_or("Steam not initialized")?;
        for id_str in &mod_ids {
            if let Ok(id) = id_str.parse::<u64>() {
                if id > 0 {
                    let file_id = steamworks::PublishedFileId(id);
                    let info = client.ugc().item_install_info(file_id);
                    let state = client.ugc().item_state(file_id);
                    let dl_info = client.ugc().item_download_info(file_id);
                    install_infos.insert(id_str.clone(), info);
                    subscription_states.insert(id_str.clone(), state);
                    if let Some(dl) = dl_info {
                        download_infos.insert(id_str.clone(), dl);
                    }
                }
            }
        }
    }

    let mut titles = std::collections::HashMap::new();
    let mut previews = std::collections::HashMap::new();
    
    if !mod_ids.is_empty() {
        let http_client = reqwest::Client::new();
        let mut params = Vec::new();
        params.push(("itemcount".to_string(), mod_ids.len().to_string()));
        for (i, id) in mod_ids.iter().enumerate() {
            params.push((format!("publishedfileids[{}]", i), id.clone()));
        }
        
        if let Ok(res) = http_client.post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
            .form(&params)
            .send()
            .await 
        {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(details) = json["response"]["publishedfiledetails"].as_array() {
                    for item in details {
                        if let (Some(id), Some(title)) = (item["publishedfileid"].as_str(), item["title"].as_str()) {
                            if !title.is_empty() {
                                titles.insert(id.to_string(), title.to_string());
                            }
                            if let Some(preview) = item["preview_url"].as_str() {
                                if !preview.is_empty() {
                                    previews.insert(id.to_string(), preview.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut mods = Vec::new();
    for id_str in mod_ids {
        if id_str.parse::<u64>().unwrap_or(0) == 0 { continue; }

        let folder_info = install_infos.get(&id_str).cloned().flatten();
        let item_state = subscription_states.get(&id_str).cloned().unwrap_or(steamworks::ItemState::empty());
        
        let mut is_subscribed = item_state.contains(steamworks::ItemState::SUBSCRIBED);
        
        if is_subscribed {
            let client_lock = state.client.lock().unwrap();
            if let Some(c) = client_lock.as_ref() {
                let list = c.ugc().subscribed_items();
                if let Ok(file_id) = id_str.parse::<u64>() {
                    if !list.contains(&steamworks::PublishedFileId(file_id)) {
                        is_subscribed = false;
                    }
                }
            }
        }
        
        let mut is_installed = item_state.contains(steamworks::ItemState::INSTALLED);
        
        if is_installed {
            if let Some(info) = install_infos.get(&id_str).and_then(|i| i.as_ref()) {
                if !std::path::Path::new(&info.folder).exists() {
                    is_installed = false;
                }
            } else {
                is_installed = false;
            }
        }

        let is_updating = item_state.contains(steamworks::ItemState::DOWNLOADING) || 
                          item_state.contains(steamworks::ItemState::NEEDS_UPDATE) || 
                          item_state.contains(steamworks::ItemState::DOWNLOAD_PENDING);
        
        let mut download_progress = None;
        let mut download_bytes = None;
        let mut total_bytes = None;
        if is_updating || (is_subscribed && !is_installed) {
            if let Some(&(downloaded, total)) = download_infos.get(&id_str) {
                if total > 0 {
                    download_progress = Some((downloaded as f64 / total as f64) * 100.0);
                    download_bytes = Some(downloaded);
                    total_bytes = Some(total);
                }
            }
        }
        
        let title = titles.get(&id_str).cloned().unwrap_or_else(|| format!("Workshop Mod #{}", id_str));
        let preview_url = previews.get(&id_str).cloned();
        
        mods.push(ModInfo {
            id: id_str,
            title,
            description: "".to_string(),
            preview_url,
            size: folder_info.map(|f| f.size_on_disk).unwrap_or(0),
            is_installed,
            is_subscribed,
            is_updating,
            download_progress,
            download_bytes,
            total_bytes,
        });
    }
    
    Ok(mods)
}

#[tauri::command]
fn find_dayz_path() -> Result<String, String> {
    let reg_paths = [
        r#"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 221100"#,
        r#"HKLM\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 221100"#
    ];
    
    for path in &reg_paths {
        let mut cmd = std::process::Command::new("reg");
        cmd.args(&["query", path, "/v", "InstallLocation"]);
        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000);
        }
        let output = cmd.output();
        
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Some(pos) = stdout.find("REG_SZ") {
                let found_path = stdout[pos + 6..].trim().to_string();
                if !found_path.is_empty() {
                    return Ok(found_path);
                }
            }
        }
    }
    
    Ok(r#"C:\Program Files (x86)\Steam\steamapps\common\DayZ"#.to_string())
}

#[tauri::command]
async fn launch_game(
    state: State<'_, SteamState>, 
    dayz_path: String, 
    ip: String, 
    port: u16, 
    custom_params: String, 
    mod_ids: Vec<String>
) -> Result<(), String> {
    // Check if game is already running
    if check_dayz_running().await.unwrap_or(false) {
        return Err("Игра уже запущена! Пожалуйста, закройте DayZ перед новым запуском.".to_string());
    }
    
    let mut mod_paths = Vec::new();
    {
        let client_lock = state.client.lock().map_err(|e| e.to_string())?;
        let client = client_lock.as_ref().ok_or("Steam not initialized")?;
        for id_str in mod_ids {
            if let Ok(id) = id_str.parse::<u64>() {
                if id > 0 {
                    if let Some(info) = client.ugc().item_install_info(steamworks::PublishedFileId(id)) {
                        mod_paths.push(info.folder);
                    }
                }
            }
        }
    }
    
    let exe_path = std::path::Path::new(&dayz_path).join("DayZ_BE.exe");
    if !exe_path.exists() {
        return Err("Файл DayZ_BE.exe не найден в указанной папке. Проверьте путь в настройках.".to_string());
    }
    
    let mut cmd = std::process::Command::new(exe_path);
    cmd.current_dir(&dayz_path);
    cmd.arg(format!("-connect={}", ip));
    cmd.arg(format!("-port={}", port));
    
    if !mod_paths.is_empty() {
        cmd.arg(format!("-mod={}", mod_paths.join(";")));
    }
    
    if !custom_params.is_empty() {
        for param in custom_params.split_whitespace() {
            cmd.arg(param);
        }
    }
    
    cmd.spawn().map_err(|e| format!("Не удалось запустить игру: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn check_dayz_running() -> Result<bool, String> {
    let mut cmd = std::process::Command::new("tasklist");
    cmd.arg("/FI").arg("IMAGENAME eq DayZ_x64.exe").arg("/NH");
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("DayZ_x64.exe"))
}

#[tauri::command]
async fn kill_dayz() -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .creation_flags(0x08000000)
            .arg("/F")
            .arg("/IM")
            .arg("DayZ_x64.exe")
            .arg("/T")
            .output();
        
        let _ = std::process::Command::new("taskkill")
            .creation_flags(0x08000000)
            .arg("/F")
            .arg("/IM")
            .arg("DayZ_BE.exe")
            .arg("/T")
            .output();
    }
    
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("pkill")
            .arg("-9")
            .arg("-f")
            .arg("DayZ")
            .output();
    }
    
    Ok(())
}

#[tauri::command]
async fn subscribe_mod(state: State<'_, SteamState>, id: String) -> Result<(), String> {
    let client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let client = client_lock.as_ref().ok_or("Steam not initialized")?;
    if let Ok(file_id) = id.parse::<u64>() {
        let pub_file_id = steamworks::PublishedFileId(file_id);
        let client_clone = client_lock.as_ref().unwrap().clone();
        client.ugc().subscribe_item(pub_file_id, move |res| {
            match res {
                Ok(_) => {
                    client_clone.ugc().download_item(pub_file_id, true);
                },
                Err(_) => {},
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn unsubscribe_mod(state: State<'_, SteamState>, id: String) -> Result<(), String> {
    let client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let client = client_lock.as_ref().ok_or("Steam not initialized")?;
    if let Ok(file_id) = id.parse::<u64>() {
        let pub_file_id = steamworks::PublishedFileId(file_id);
        if let Some(install_info) = client.ugc().item_install_info(pub_file_id) {
            let path_str = install_info.folder.clone();
            std::thread::spawn(move || {
                let path = std::path::Path::new(&path_str);
                if path.exists() {
                    let _ = std::fs::remove_dir_all(path);
                }
            });
        }
        client.ugc().unsubscribe_item(pub_file_id, move |_| {});
    }
    Ok(())
}

#[tauri::command]
fn download_mod(state: State<'_, SteamState>, id: String) -> Result<bool, String> {
    let client_lock = state.client.lock().map_err(|e| e.to_string())?;
    let client = client_lock.as_ref().ok_or("Steam not initialized")?;
    if let Ok(file_id) = id.parse::<u64>() {
        Ok(client.ugc().download_item(steamworks::PublishedFileId(file_id), true))
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(&["/C", "start", "", &url]);
    
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    cmd.spawn().map_err(|e| format!("Не удалось открыть ссылку: {}", e))?;
    Ok(())
}

#[tauri::command]
fn validate_dayz_path(path: String) -> bool {
    let p = std::path::Path::new(&path).join("DayZ_BE.exe");
    p.exists()
}

#[tauri::command]
async fn ping_target(ip: String) -> Result<u64, String> {
    let mut cmd = tokio::process::Command::new("ping");
    cmd.args(&["-n", "1", "-w", "2000", &ip]);
    
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output()
        .await
        .map_err(|e| e.to_string())?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        return Err("Ping failed".to_string());
    }

    let lines: Vec<&str> = stdout.lines().collect();
    for line in lines.iter().rev() {
        if let Some(eq_pos) = line.rfind('=') {
            let part = &line[eq_pos + 1..].trim();
            let digits: String = part.chars().take_while(|c| c.is_digit(10)).collect();
            if !digits.is_empty() {
                if let Ok(ms) = digits.parse::<u64>() {
                    return Ok(ms);
                }
            }
        }
    }
    Err("Could not parse ping".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (client, single) = match Client::init_app(AppId(221100)) {
        Ok((client, single)) => (Some(client), Some(single)),
        Err(e) => {
            eprintln!("Steam initialization failed: {}", e);
            (None, None)
        },
    };

    let steam_client = Arc::new(Mutex::new(client));
    let steam_single = Arc::new(Mutex::new(single));

    let single_clone = steam_single.clone();
    std::thread::spawn(move || {
        loop {
            if let Ok(lock) = single_clone.lock() {
                if let Some(s) = lock.as_ref() {
                    s.run_callbacks();
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SteamState {
            client: steam_client,
            single: steam_single,
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Background process monitor
            std::thread::spawn(move || {
                let mut last_state = false;
                loop {
                    let output = {
                        #[cfg(windows)]
                        {
                            std::process::Command::new("tasklist")
                                .creation_flags(0x08000000)
                                .arg("/FI")
                                .arg("IMAGENAME eq DayZ_x64.exe")
                                .arg("/NH")
                                .output()
                        }
                        #[cfg(not(windows))]
                        {
                            std::process::Command::new("pgrep")
                                .arg("-x")
                                .arg("DayZ_x64.exe")
                                .output()
                        }
                    };
                    
                    let is_running = if let Ok(out) = output {
                        String::from_utf8_lossy(&out.stdout).contains("DayZ_x64.exe")
                    } else {
                        false
                    };

                    if is_running != last_state {
                        last_state = is_running;
                        let _ = app_handle.emit("dayz-status-changed", is_running);
                    }
                    
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });
            
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_steam_user, 
            query_servers, 
            get_server_mods,
            subscribe_mod,
            unsubscribe_mod,
            download_mod,
            find_dayz_path,
            launch_game,
            open_url,
            get_steam_avatar,
            ping_target,
            check_dayz_running,
            kill_dayz,
            validate_dayz_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
