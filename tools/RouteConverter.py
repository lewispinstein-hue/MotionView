# 
# Programmed using AI. Only used for creating example routes from 
# path.jerryio.com files 
#

import sys
import math
import json
import argparse

def normalize_angle(angle_deg):
    return angle_deg % 360.0

def shortest_angle_diff(target_deg, current_deg):
    return (target_deg - current_deg + 180.0) % 360.0 - 180.0

def slew_limit(target, prev, rise_delta):
    """Limits ONLY acceleration. Deceleration is instantaneous."""
    if target == prev:
        return target

    delta = target - prev
    accelerating = (prev == 0) or ((prev > 0 and target > prev) or (prev < 0 and target < prev))

    if accelerating:
        if delta > rise_delta: return prev + rise_delta
        if delta < -rise_delta: return prev - rise_delta
        return target
    else:
        return target

def get_point_at_dist(d, raw_points, path_dists):
    """Interpolates the exact X/Y coordinate at a given distance along the 1D path."""
    if d <= 0: return raw_points[0]['x'], raw_points[0]['y']
    if d >= path_dists[-1]: return raw_points[-1]['x'], raw_points[-1]['y']

    idx = 0
    while idx < len(path_dists) - 2 and path_dists[idx + 1] <= d:
        idx += 1

    seg_len = path_dists[idx+1] - path_dists[idx]
    ratio = (d - path_dists[idx]) / seg_len if seg_len > 0 else 1.0

    x = raw_points[idx]['x'] + ratio * (raw_points[idx+1]['x'] - raw_points[idx]['x'])
    y = raw_points[idx]['y'] + ratio * (raw_points[idx+1]['y'] - raw_points[idx]['y'])
    return x, y

def process_file(input_path, output_path, rise_delta, lookahead_dist, track_width):
    raw_points = []

    with open(input_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            if 'endData' in line or '#PATH.JERRYIO-DATA' in line: break

            parts = line.split(',')
            try:
                x_str = parts[0].split()[-1]
                raw_points.append({
                    "x": float(x_str),
                    "y": float(parts[1]),
                    "speed": float(parts[2]),
                    "explicit_heading": float(parts[3]) if len(parts) >= 4 else None
                })
            except (ValueError, IndexError):
                continue

    if len(raw_points) < 2:
        print("Error: Not enough valid path points found.")
        sys.exit(1)

    # Map the Path Distances
    path_dists = [0.0]
    for i in range(1, len(raw_points)):
        d = math.hypot(raw_points[i]['x'] - raw_points[i-1]['x'], 
                       raw_points[i]['y'] - raw_points[i-1]['y'])
        path_dists.append(path_dists[-1] + d)

    total_path_length = path_dists[-1]

    # Setup physics & state
    t = 3500 # start time
    dt = 0.1 # timestep
    poses = []

    current_dist = 0.0
    current_v = 0.0

    sim_x = raw_points[0]['x']
    sim_y = raw_points[0]['y']

    if raw_points[0]['explicit_heading'] is not None:
        sim_theta = normalize_angle(raw_points[0]['explicit_heading'])
    else:
        dx = raw_points[1]['x'] - sim_x
        dy = raw_points[1]['y'] - sim_y
        sim_theta = normalize_angle(math.degrees(math.atan2(dx, dy)))

    poses.append({
        "t": t, "x": round(sim_x, 3), "y": round(sim_y, 3), 
        "theta": round(sim_theta, 3), "l_vel": 0.0, "r_vel": 0.0, "speed": 0.0
    })

    t += 100
    max_cycles = 20000 
    cycle_count = 0

    # Tracing Loop
    while current_dist < total_path_length and cycle_count < max_cycles:
        cycle_count += 1

        # Apply Lookahead to find Target Speed
        target_dist = current_dist + lookahead_dist

        target_idx = 0
        while target_idx < len(path_dists) - 1 and path_dists[target_idx] < target_dist:
            target_idx += 1

        target_V_demand = raw_points[target_idx]['speed']

        # Prevent Premature Stopping at the finish line
        dist_remaining = total_path_length - current_dist
        if target_idx >= len(raw_points) - 2 and dist_remaining > 0.1:
            current_idx = 0
            while current_idx < len(path_dists) - 1 and path_dists[current_idx] < current_dist:
                current_idx += 1
            target_V_demand = raw_points[current_idx]['speed']

        # Global Anti-Freeze Logic
        if abs(target_V_demand) < 1.0:
            target_V_demand = 20.0 if target_V_demand >= 0 else -20.0

        # Acceleration only slew
        if abs(target_V_demand) > abs(current_v) and (current_v * target_V_demand >= 0 or current_v == 0):
            delta = target_V_demand - current_v
            if delta > rise_delta:
                current_v += rise_delta
            elif delta < -rise_delta:
                current_v -= rise_delta
            else:
                current_v = target_V_demand
        else:
            # Instant Deceleration
            current_v = target_V_demand

        # Exact Position Update
        step_distance = abs(current_v) * dt

        if current_dist + step_distance >= total_path_length:
            current_dist = total_path_length
        else:
            current_dist += step_distance

        idx = 0
        while idx < len(path_dists) - 2 and path_dists[idx + 1] <= current_dist:
            idx += 1

        segment_length = path_dists[idx+1] - path_dists[idx]
        if segment_length > 0:
            ratio = (current_dist - path_dists[idx]) / segment_length
        else:
            ratio = 1.0

        new_x = raw_points[idx]['x'] + ratio * (raw_points[idx+1]['x'] - raw_points[idx]['x'])
        new_y = raw_points[idx]['y'] + ratio * (raw_points[idx+1]['y'] - raw_points[idx]['y'])

        carrot_dist = min(current_dist + lookahead_dist, total_path_length)

        c_idx = 0
        while c_idx < len(path_dists) - 2 and path_dists[c_idx + 1] <= carrot_dist:
            c_idx += 1

        c_seg_len = path_dists[c_idx+1] - path_dists[c_idx]
        c_ratio = (carrot_dist - path_dists[c_idx]) / c_seg_len if c_seg_len > 0 else 1.0

        target_x = raw_points[c_idx]['x'] + c_ratio * (raw_points[c_idx+1]['x'] - raw_points[c_idx]['x'])
        target_y = raw_points[c_idx]['y'] + c_ratio * (raw_points[c_idx+1]['y'] - raw_points[c_idx]['y'])

        dx = target_x - new_x
        dy = target_y - new_y
        actual_ld = math.hypot(dx, dy)

        if actual_ld > 0.001:
            abs_target_angle = normalize_angle(math.degrees(math.atan2(dx, dy)))

            if current_v < 0: 
                rear_theta = normalize_angle(sim_theta + 180.0)
                alpha = shortest_angle_diff(abs_target_angle, rear_theta)
            else:
                alpha = shortest_angle_diff(abs_target_angle, sim_theta)

            alpha_rad = math.radians(alpha)
            curvature = (2.0 * math.sin(alpha_rad)) / actual_ld
            desired_omega = abs(current_v) * curvature
        else:
            alpha_rad = 0.0
            desired_omega = 0.0

        # Override if path demands a hard explicit heading
        if raw_points[idx]['explicit_heading'] is not None:
            explicit_theta = normalize_angle(raw_points[idx]['explicit_heading'])
            alpha_rad = math.radians(shortest_angle_diff(explicit_theta, sim_theta))
            desired_omega = alpha_rad / dt

        # Critically Damped Clamp
        # Calculate exactly how much turn is required to perfectly face the target in 1 tick
        max_omega_step = alpha_rad / dt

        # If Pure Pursuit wants to turn PAST the target in a single frame, we clamp it to prevent overshoot
        if alpha_rad > 0:
            actual_omega = min(desired_omega, max_omega_step)
        else:
            actual_omega = max(desired_omega, max_omega_step)

        # Global safety cap
        max_physical_omega = math.pi * 4  
        actual_omega = max(-max_physical_omega, min(max_physical_omega, actual_omega))

        # Clockwise Coordinate Fix for Left/Right Wheels
        l_vel = current_v + (actual_omega * (track_width / 2.0))
        r_vel = current_v - (actual_omega * (track_width / 2.0))
        
        sim_theta = normalize_angle(sim_theta + math.degrees(actual_omega * dt))
        sim_x, sim_y = new_x, new_y

        poses.append({
            "t": t, "x": round(sim_x, 3), "y": round(sim_y, 3),
            "theta": round(sim_theta, 3), "l_vel": round(l_vel, 3),
            "r_vel": round(r_vel, 3), "speed": round(current_v, 3) 
        })

        t += 100 
        if current_dist >= total_path_length: break

    if cycle_count >= max_cycles:
        print("Warning: Simulation hit safety timeout. Path may be incomplete.")

    output_payload = {
        "poses": poses, "watches": [], "logs": [], "waypoints": [],
        "meta": { "SchemaVersion": 2 }
    }

    with open(output_path, 'w') as out_file:
        json.dump(output_payload, out_file, indent=2)

    print(f"Successfully simulated and exported {len(poses)} exact-trace states.")
    print(f"Output saved to {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert path.jerryio txt log to MotionView v2 using Exact Trace.")
    parser.add_argument("input_file", help="Path to the input .txt file")
    parser.add_argument("output_file", help="Path to the output .json file")
    parser.add_argument("-r", "--rise", type=float, default=12.0, help="Maximum acceleration delta per 100ms interval")
    parser.add_argument("-l", "--lookahead", type=float, default=15.0, help="Distance along the path to aim for")
    parser.add_argument("-tw", "--track-width", type=float, default=11.0, help="Track width in inches (increases difference between l_vel and r_vel)")

    args = parser.parse_args()
    process_file(args.input_file, args.output_file, args.rise, args.lookahead, args.track_width)