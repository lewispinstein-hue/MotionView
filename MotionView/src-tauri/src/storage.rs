use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const CLEAN_BACKUP: &str = "last-clean-session.json";
pub static DOCUMENT_LOCK: Mutex<()> = Mutex::new(());
static RECOVERY_NOTICES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, Copy)]
pub enum DocumentKind {
    Settings,
    SavedPaths,
}

impl DocumentKind {
    fn key(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::SavedPaths => "savedPaths",
        }
    }
    fn description(self) -> &'static str {
        match self {
            Self::Settings => "preferences",
            Self::SavedPaths => "planning paths and recordings",
        }
    }
}

pub fn validate(contents: &str, kind: DocumentKind) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| error.to_string())?;
    let object = value
        .as_object()
        .ok_or("Saved data must contain a JSON object")?;
    if matches!(kind, DocumentKind::SavedPaths) {
        let arrays = [
            "planned-path",
            "planned-paths",
            "planned-objects",
            "planned-nodes",
            "poses",
            "robot-path",
            "watches",
            "watch",
            "logs",
            "log",
            "waypoints",
        ];
        if !arrays
            .iter()
            .any(|key| object.get(*key).is_some_and(|value| value.is_array()))
        {
            return Err("Saved paths contain no recognized route data".into());
        }
        if arrays.iter().any(|key| {
            object
                .get(*key)
                .is_some_and(|value| !value.is_null() && !value.is_array())
        }) {
            return Err("Saved route data must contain arrays".into());
        }
    }
    Ok(value)
}

fn sync_directory(parent: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(parent)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        Ok(())
    }
}

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

// Write/sync beside the destination before replacing it. In particular, never
// remove the old file to make rename succeed on Windows.
pub fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    atomic_write_with(path, contents, |_, _| Ok(()))
}

fn atomic_write_with(
    path: &Path,
    contents: &[u8],
    before_replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing parent folder"))?;
    let temporary = TemporaryFile(parent.join(format!(".motionview-{}.tmp", uuid::Uuid::new_v4())));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary.0)?;
    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(path) {
        file.set_permissions(metadata.permissions())?;
    }
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    before_replace(&temporary.0, path)?;
    fs::rename(&temporary.0, path)?;
    sync_directory(parent)
}

/// A new export must exclusively create its name; a separate existence check
/// cannot authorize overwriting a file created in the meantime.
pub fn write_export(path: &Path, contents: &[u8], overwrite: bool) -> io::Result<()> {
    if overwrite {
        return atomic_write(path, contents);
    }
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result?;
    sync_directory(
        path.parent()
            .ok_or_else(|| io::Error::other("Missing parent folder"))?,
    )
}

pub struct ReadOutcome {
    pub contents: Option<String>,
    pub notice: Option<String>,
}

fn read_optional(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        // Invalid UTF-8 is damaged data, not an access error.
        Err(error) if error.kind() == io::ErrorKind::InvalidData => Ok(Some(String::new())),
        Err(error) => Err(error),
    }
}

pub fn read_document(path: &Path, kind: DocumentKind) -> Result<ReadOutcome, String> {
    if let Some(contents) = read_optional(path).map_err(|error| error.to_string())? {
        if validate(&contents, kind).is_ok() {
            return Ok(ReadOutcome {
                contents: Some(contents),
                notice: None,
            });
        }
    }
    let backup = path
        .parent()
        .ok_or("Missing data folder")?
        .join(CLEAN_BACKUP);
    let recovered = read_optional(&backup)
        .map_err(|error| error.to_string())?
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|snapshot| snapshot.get(kind.key()).cloned())
        .map(|value| value.to_string())
        .filter(|contents| validate(contents, kind).is_ok());
    let Some(contents) = recovered else {
        // New installs, upgrades without a checkpoint, deliberately cleared
        // data, and unrecoverable files all regenerate through normal defaults.
        return Ok(ReadOutcome {
            contents: None,
            notice: None,
        });
    };
    let mut notice = format!(
        "MotionView restored your {} from the last clean shutdown.",
        kind.description()
    );
    if let Err(error) = atomic_write(path, contents.as_bytes()) {
        notice.push_str(&format!(
            " The recovered data is open, but could not be saved: {error}"
        ));
    }
    Ok(ReadOutcome {
        contents: Some(contents),
        notice: Some(notice),
    })
}

pub fn remember_notice(notice: Option<String>) {
    if let Some(notice) = notice {
        let mut notices = RECOVERY_NOTICES
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !notices.contains(&notice) {
            notices.push(notice);
        }
    }
}

#[tauri::command]
pub fn take_persistence_notices() -> Vec<String> {
    std::mem::take(
        &mut *RECOVERY_NOTICES
            .lock()
            .unwrap_or_else(|error| error.into_inner()),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownData {
    pub settings_contents: String,
    pub saved_paths_contents: String,
}

pub fn commit_clean_shutdown(
    settings: &Path,
    paths: &Path,
    data: &ShutdownData,
) -> Result<(), String> {
    let settings_value = validate(&data.settings_contents, DocumentKind::Settings)?;
    let paths_value = validate(&data.saved_paths_contents, DocumentKind::SavedPaths)?;
    let backup = settings
        .parent()
        .ok_or("Missing data folder")?
        .join(CLEAN_BACKUP);
    let snapshot = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1, "settings": settings_value, "savedPaths": paths_value,
    }))
    .map_err(|error| error.to_string())?;
    let _guard = DOCUMENT_LOCK.lock().map_err(|error| error.to_string())?;
    atomic_write(settings, data.settings_contents.as_bytes()).map_err(|error| error.to_string())?;
    atomic_write(paths, data.saved_paths_contents.as_bytes()).map_err(|error| error.to_string())?;
    // Only finalizing a clean quit can replace this one checkpoint. Ordinary
    // autosaves and recovery never rotate or update it.
    atomic_write(&backup, &snapshot).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("motionview-storage-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn data(value: i32) -> ShutdownData {
        ShutdownData {
            settings_contents: format!(r#"{{"robotW":"{value}"}}"#),
            saved_paths_contents: format!(r#"{{"robot-path":[{{"x":{value},"y":2}}]}}"#),
        }
    }

    #[test]
    fn failed_replacement_keeps_old_file_and_removes_temporary_file() {
        let folder = Folder::new();
        let path = folder.file("current.json");
        atomic_write(&path, b"old").unwrap();
        assert!(atomic_write_with(&path, b"new", |temporary, destination| {
            assert_eq!(fs::read(temporary).unwrap(), b"new");
            assert_eq!(fs::read(destination).unwrap(), b"old");
            Err(io::Error::other("injected failure after sync"))
        })
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old");
        assert_eq!(fs::read_dir(&folder.0).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn replacement_preserves_existing_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let folder = Folder::new();
        let path = folder.file("private.json");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }
    #[test]
    fn crashed_staging_file_never_replaces_valid_primary() {
        let folder = Folder::new();
        let path = folder.file("settings.json");
        atomic_write(&path, data(1).settings_contents.as_bytes()).unwrap();
        fs::write(folder.file(".motionview-interrupted.tmp"), b"incomplete").unwrap();
        assert_eq!(
            read_document(&path, DocumentKind::Settings)
                .unwrap()
                .contents
                .unwrap(),
            data(1).settings_contents
        );
    }
    #[test]
    fn autosaving_current_state_never_changes_clean_checkpoint() {
        let folder = Folder::new();
        let settings = folder.file("settings.json");
        let paths = folder.file("paths.json");
        commit_clean_shutdown(&settings, &paths, &data(1)).unwrap();
        let backup = fs::read(folder.file(CLEAN_BACKUP)).unwrap();
        atomic_write(&settings, data(2).settings_contents.as_bytes()).unwrap();
        atomic_write(&paths, data(2).saved_paths_contents.as_bytes()).unwrap();
        assert_eq!(fs::read(folder.file(CLEAN_BACKUP)).unwrap(), backup);
        assert_eq!(
            read_document(&paths, DocumentKind::SavedPaths)
                .unwrap()
                .contents
                .unwrap(),
            data(2).saved_paths_contents
        );
        commit_clean_shutdown(&settings, &paths, &data(3)).unwrap();
        assert_ne!(fs::read(folder.file(CLEAN_BACKUP)).unwrap(), backup);
        assert_eq!(fs::read_dir(&folder.0).unwrap().count(), 3);
    }
    #[test]
    fn corrupt_or_missing_primary_recovers_and_repairs_from_one_checkpoint() {
        let folder = Folder::new();
        let settings = folder.file("settings.json");
        let paths = folder.file("paths.json");
        commit_clean_shutdown(&settings, &paths, &data(1)).unwrap();
        let backup = fs::read(folder.file(CLEAN_BACKUP)).unwrap();
        for broken in [b"{".as_slice(), b"[]", b"null", b"\xff"] {
            fs::write(&settings, broken).unwrap();
            let restored = read_document(&settings, DocumentKind::Settings).unwrap();
            assert!(restored.notice.is_some());
            assert!(validate(&restored.contents.unwrap(), DocumentKind::Settings).is_ok());
            assert!(validate(
                &fs::read_to_string(&settings).unwrap(),
                DocumentKind::Settings
            )
            .is_ok());
        }
        fs::remove_file(&paths).unwrap();
        let restored = read_document(&paths, DocumentKind::SavedPaths).unwrap();
        assert!(restored
            .notice
            .unwrap()
            .contains("planning paths and recordings"));
        assert_eq!(fs::read(folder.file(CLEAN_BACKUP)).unwrap(), backup);
    }
    #[test]
    fn no_valid_copy_regenerates_and_next_save_works() {
        let folder = Folder::new();
        let settings = folder.file("settings.json");
        for broken in [None, Some("{"), Some("[]")] {
            if let Some(broken) = broken {
                fs::write(&settings, broken).unwrap();
            }
            let outcome = read_document(&settings, DocumentKind::Settings).unwrap();
            assert!(outcome.contents.is_none());
            assert!(outcome.notice.is_none());
        }
        fs::write(folder.file(CLEAN_BACKUP), b"invalid backup").unwrap();
        assert!(read_document(&settings, DocumentKind::Settings)
            .unwrap()
            .contents
            .is_none());
        atomic_write(&settings, data(2).settings_contents.as_bytes()).unwrap();
        assert!(read_document(&settings, DocumentKind::Settings)
            .unwrap()
            .contents
            .is_some());
    }

    #[test]
    fn legacy_optional_null_arrays_remain_valid_but_invalid_route_shapes_do_not() {
        assert!(validate(
            r#"{"robot-path":[],"watches":null,"logs":null}"#,
            DocumentKind::SavedPaths
        )
        .is_ok());
        for invalid in [
            r#"{"robot-path":42}"#,
            r#"{"robot-path":null}"#,
            r#"{"poses":[],"watches":{}}"#,
        ] {
            assert!(validate(invalid, DocumentKind::SavedPaths).is_err());
        }
    }
    #[test]
    fn malformed_shutdown_does_not_replace_checkpoint_or_current_data() {
        let folder = Folder::new();
        let settings = folder.file("settings.json");
        let paths = folder.file("paths.json");
        commit_clean_shutdown(&settings, &paths, &data(1)).unwrap();
        let backup = fs::read(folder.file(CLEAN_BACKUP)).unwrap();
        let mut invalid = data(2);
        invalid.saved_paths_contents = "{}".into();
        assert!(commit_clean_shutdown(&settings, &paths, &invalid).is_err());
        assert_eq!(fs::read(folder.file(CLEAN_BACKUP)).unwrap(), backup);
        assert_eq!(
            fs::read_to_string(&settings).unwrap(),
            data(1).settings_contents
        );
    }
    #[test]
    fn failed_current_write_does_not_touch_checkpoint() {
        let folder = Folder::new();
        let settings = folder.file("settings.json");
        let paths = folder.file("paths.json");
        commit_clean_shutdown(&settings, &paths, &data(1)).unwrap();
        let backup = fs::read(folder.file(CLEAN_BACKUP)).unwrap();
        fs::remove_file(&paths).unwrap();
        fs::create_dir(&paths).unwrap();
        assert!(commit_clean_shutdown(&settings, &paths, &data(2)).is_err());
        assert_eq!(fs::read(folder.file(CLEAN_BACKUP)).unwrap(), backup);
    }
    #[test]
    fn exclusive_export_refuses_existing_file_and_overwrite_replaces_it() {
        let folder = Folder::new();
        let path = folder.file("export.json");
        write_export(&path, b"first", false).unwrap();
        assert_eq!(
            write_export(&path, b"second", false).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&path).unwrap(), b"first");
        write_export(&path, b"second", true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
    }
    #[test]
    fn simultaneous_new_exports_cannot_overwrite_each_other() {
        let folder = Folder::new();
        let path = folder.file("export.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = [b"first".as_slice(), b"second".as_slice()]
            .into_iter()
            .map(|bytes| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    write_export(&path, bytes, false)
                })
            })
            .collect();
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(matches!(
            fs::read(&path).unwrap().as_slice(),
            b"first" | b"second"
        ));
    }
}
