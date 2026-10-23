use crate::settings::WindowState;

#[derive(Clone, Copy, Debug)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

#[derive(Clone, Copy, Debug, Default)]
struct FrameSize {
    // Logical decoration size: saved dimensions describe the client area,
    // while positions and monitor work areas describe the outer window.
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn physical(value: f64, scale: f64) -> u32 {
    (value * scale).round().clamp(0.0, u32::MAX as f64) as u32
}

fn valid_area(area: &WorkArea) -> bool {
    area.width > 0 && area.height > 0 && area.scale.is_finite() && area.scale > 0.0
}

fn overlap(state: &WindowState, area: &WorkArea, frame: FrameSize) -> i64 {
    let width = i64::from(state.width) + i64::from(physical(frame.width, area.scale));
    let height = i64::from(state.height) + i64::from(physical(frame.height, area.scale));
    let visible_width = (i64::from(state.x) + width).min(i64::from(area.x) + i64::from(area.width))
        - i64::from(state.x).max(i64::from(area.x));
    let visible_height = (i64::from(state.y) + height)
        .min(i64::from(area.y) + i64::from(area.height))
        - i64::from(state.y).max(i64::from(area.y));
    visible_width.max(0).saturating_mul(visible_height.max(0))
}

fn caption_visible(state: &WindowState, area: &WorkArea, frame: FrameSize) -> bool {
    if state.width == 0 || state.height == 0 {
        return false;
    }
    let width = i64::from(state.width) + i64::from(physical(frame.width, area.scale));
    let visible_width = (i64::from(state.x) + width).min(i64::from(area.x) + i64::from(area.width))
        - i64::from(state.x).max(i64::from(area.x));
    // A sliver of the content is insufficient: retain access to the title bar.
    let caption_height = physical(32.0, area.scale).min(area.height);
    state.y >= area.y
        && i64::from(state.y) + i64::from(caption_height)
            <= i64::from(area.y) + i64::from(area.height)
        && visible_width >= width.min(i64::from(physical(128.0, area.scale)))
}

fn fit(state: &WindowState, area: &WorkArea, frame: FrameSize, center: bool) -> Bounds {
    let frame_width = physical(frame.width, area.scale).min(area.width.saturating_sub(1));
    let frame_height = physical(frame.height, area.scale).min(area.height.saturating_sub(1));
    let maximum_width = area.width - frame_width;
    let maximum_height = area.height - frame_height;
    let old_scale = state
        .scale_factor
        .filter(|scale| scale.is_finite() && *scale > 0.0);
    let ratio = old_scale.map_or(1.0, |scale| area.scale / scale);
    let width = physical(f64::from(state.width), ratio).clamp(
        physical(320.0, area.scale).max(1).min(maximum_width),
        maximum_width,
    );
    let height = physical(f64::from(state.height), ratio).clamp(
        physical(240.0, area.scale).max(1).min(maximum_height),
        maximum_height,
    );
    let available_x = i64::from(area.width - width - frame_width);
    let available_y = i64::from(area.height - height - frame_height);
    let x = if center {
        i64::from(area.x) + available_x / 2
    } else {
        i64::from(state.x).clamp(i64::from(area.x), i64::from(area.x) + available_x)
    };
    let y = if center {
        i64::from(area.y) + available_y / 2
    } else {
        i64::from(state.y).clamp(i64::from(area.y), i64::from(area.y) + available_y)
    };
    Bounds {
        x: x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width,
        height,
    }
}

fn restored_bounds(state: &WindowState, areas: &[WorkArea], frame: FrameSize) -> Option<Bounds> {
    let fallback = areas.iter().find(|area| valid_area(area))?;
    let target = areas
        .iter()
        .filter(|area| valid_area(area) && caption_visible(state, area, frame))
        .max_by_key(|area| overlap(state, area, frame));
    Some(fit(
        state,
        target.unwrap_or(fallback),
        frame,
        target.is_none(),
    ))
}

fn default_bounds(areas: &[WorkArea], frame: FrameSize) -> Option<Bounds> {
    let area = areas.iter().find(|area| valid_area(area))?;
    // Match tauri.conf.json's default logical client size.
    let state = WindowState {
        x: area.x,
        y: area.y,
        width: physical(800.0, area.scale),
        height: physical(600.0, area.scale),
        fullscreen: false,
        scale_factor: Some(area.scale),
    };
    Some(fit(&state, area, frame, true))
}

fn work_areas(window: &tauri::WebviewWindow, reset: bool) -> Result<Vec<WorkArea>, String> {
    // Restore inaccessible placements onto the primary display. A deliberate
    // reset instead centers on the screen currently containing the window.
    let mut preferred = if reset {
        window.current_monitor()
    } else {
        window.primary_monitor()
    }
    .map_err(|error| error.to_string())?;
    if reset && preferred.is_none() {
        preferred = window.primary_monitor().map_err(|error| error.to_string())?;
    }
    let mut monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if let Some(preferred) = preferred {
        monitors.insert(0, preferred);
    }
    Ok(monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
                scale: monitor.scale_factor(),
            }
        })
        .collect())
}

fn frame_size(window: &tauri::WebviewWindow) -> FrameSize {
    match (
        window.outer_size(),
        window.inner_size(),
        window.scale_factor(),
    ) {
        (Ok(outer), Ok(inner), Ok(scale)) if scale.is_finite() && scale > 0.0 => FrameSize {
            width: f64::from(outer.width.saturating_sub(inner.width)) / scale,
            height: f64::from(outer.height.saturating_sub(inner.height)) / scale,
        },
        _ => FrameSize::default(),
    }
}

fn apply(window: &tauri::WebviewWindow, bounds: Bounds) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())
}

pub fn restore(window: &tauri::WebviewWindow, state: &WindowState) -> Result<(), String> {
    let bounds = restored_bounds(state, &work_areas(window, false)?, frame_size(window))
        .ok_or("No usable monitor work area is available")?;
    apply(window, bounds)?;
    if state.fullscreen {
        window
            .set_fullscreen(true)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn reset(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let areas = work_areas(window, true)?;
    window
        .set_fullscreen(false)
        .map_err(|error| error.to_string())?;
    window.unmaximize().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    let bounds = default_bounds(&areas, frame_size(window))
        .ok_or("No usable monitor work area is available")?;
    apply(window, bounds)?;
    window.set_focus().map_err(|error| error.to_string())?;
    crate::settings::write_window_state(
        app,
        &WindowState {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            fullscreen: false,
            scale_factor: areas
                .iter()
                .find(|area| valid_area(area))
                .map(|area| area.scale),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME: FrameSize = FrameSize {
        width: 16.0,
        height: 38.0,
    };
    const PRIMARY: WorkArea = WorkArea {
        x: 0,
        y: 40,
        width: 1920,
        height: 1040,
        scale: 1.0,
    };

    fn state(x: i32, y: i32, width: u32, height: u32) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
            fullscreen: false,
            scale_factor: None,
        }
    }

    #[test]
    fn valid_position_and_client_size_are_preserved_without_frame_growth() {
        let result = restored_bounds(&state(100, 100, 800, 600), &[PRIMARY], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: 100,
                y: 100,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn negative_coordinate_secondary_display_is_preserved() {
        let secondary = WorkArea {
            x: -1920,
            ..PRIMARY
        };
        let result =
            restored_bounds(&state(-1600, 200, 1000, 700), &[PRIMARY, secondary], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: -1600,
                y: 200,
                width: 1000,
                height: 700
            }
        );
    }

    #[test]
    fn removed_monitor_recenters_on_primary_work_area() {
        let result = restored_bounds(&state(2400, -900, 800, 600), &[PRIMARY], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: 552,
                y: 241,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn visible_content_without_accessible_title_bar_is_recentered() {
        let result = restored_bounds(&state(100, -50, 800, 600), &[PRIMARY], FRAME).unwrap();
        assert_eq!(result.x, 552);
        assert_eq!(result.y, 241);
        let sliver = restored_bounds(&state(-800, 100, 800, 600), &[PRIMARY], FRAME).unwrap();
        assert_eq!(sliver.x, 552);
    }

    #[test]
    fn partially_visible_window_is_clamped_inside_work_area() {
        let result = restored_bounds(&state(-500, 800, 800, 600), &[PRIMARY], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: 0,
                y: 442,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn oversized_and_invalid_sizes_fit_decorations_and_usable_minimum() {
        let result =
            restored_bounds(&state(100, 100, u32::MAX, u32::MAX), &[PRIMARY], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: 0,
                y: 40,
                width: 1904,
                height: 1002
            }
        );
        let zero = restored_bounds(&state(100, 100, 0, 0), &[PRIMARY], FRAME).unwrap();
        assert_eq!((zero.width, zero.height), (320, 240));
    }

    #[test]
    fn scale_changes_preserve_logical_size_and_fit_the_new_screen() {
        let mut saved = state(100, 100, 1600, 1200);
        saved.scale_factor = Some(2.0);
        let result = restored_bounds(&saved, &[PRIMARY], FRAME).unwrap();
        assert_eq!((result.width, result.height), (800, 600));
        let retina = WorkArea {
            width: 3840,
            height: 2080,
            scale: 2.0,
            ..PRIMARY
        };
        saved.width = 800;
        saved.height = 600;
        saved.scale_factor = Some(1.0);
        let result = restored_bounds(&saved, &[retina], FRAME).unwrap();
        assert_eq!((result.width, result.height), (1600, 1200));
    }

    #[test]
    fn tiny_work_areas_and_extreme_coordinates_never_overflow() {
        let tiny = WorkArea {
            x: i32::MIN,
            y: i32::MAX - 100,
            width: 100,
            height: 100,
            scale: 1.0,
        };
        let result = restored_bounds(
            &state(i32::MAX, i32::MIN, u32::MAX, u32::MAX),
            &[tiny],
            FRAME,
        )
        .unwrap();
        assert_eq!(
            result,
            Bounds {
                x: i32::MIN,
                y: i32::MAX - 100,
                width: 84,
                height: 62
            }
        );
        assert!(restored_bounds(&state(0, 0, 800, 600), &[], FRAME).is_none());
        assert!(restored_bounds(
            &state(0, 0, 800, 600),
            &[WorkArea {
                width: 0,
                ..PRIMARY
            }],
            FRAME
        )
        .is_none());
        let huge = WorkArea {
            x: i32::MIN,
            y: i32::MIN,
            width: u32::MAX,
            height: u32::MAX,
            scale: 1.0,
        };
        assert!(restored_bounds(
            &state(i32::MIN, i32::MIN, u32::MAX, u32::MAX),
            &[huge],
            FRAME
        )
        .is_some());
    }

    #[test]
    fn reset_uses_default_logical_size_centered_on_preferred_screen() {
        let screen = WorkArea {
            x: -3840,
            y: 0,
            width: 3840,
            height: 2080,
            scale: 2.0,
        };
        let result = default_bounds(&[screen, PRIMARY], FRAME).unwrap();
        assert_eq!(
            result,
            Bounds {
                x: -2736,
                y: 402,
                width: 1600,
                height: 1200
            }
        );
    }

    #[test]
    fn legacy_state_without_scale_and_invalid_scale_remain_readable() {
        let mut saved: WindowState = serde_json::from_str(
            r#"{"x":100,"y":100,"width":800,"height":600,"fullscreen":false}"#,
        )
        .unwrap();
        assert!(saved.scale_factor.is_none());
        for scale in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            saved.scale_factor = Some(scale);
            let result = restored_bounds(&saved, &[PRIMARY], FRAME).unwrap();
            assert_eq!((result.width, result.height), (800, 600));
        }
    }
}
