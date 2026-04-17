#pragma once
/**
 * @file waypoint.hpp
 * @brief Contains user-facing information relating 
 *       to handling and creating waypoints
 */

#include <optional>
#include <cstdint>
#include <string>

namespace mvlib {
using WPId = uint16_t;

/**
 * @struct Waypoint
 * @brief Holds a location and tolerances for a point.
*/
struct WaypointParams {
  /// @brief The target X value of the point
  double tarX;

  /// @brief The target Y value of the point
  double tarY;

  /// @brief The optional target theta value of the point
  std::optional<double> tarT = std::nullopt;

  /// @brief Time within construction before considering point to be not reached
  std::optional<uint32_t> timeoutMs = std::nullopt;


  /// @brief Tolerance to be considered at the point for X and Y
  float linearTol;

  /// @brief Tolerance to be considered at the point for theta
  std::optional<float> thetaTol = std::nullopt;

  /// @brief Make waypoint retriggerable. It will always log when reached, 
  ///        and deactivate only on timeout (if provided)
  bool retriggerable = false;
};

struct WaypointOffset {
  /// @brief Linear distance between current pose and target pose
  double totalOffset;

  /// @brief X Offset. Linear distance between current X and target X
  double offX;

  /// @brief Y Offset.Linear distance between current Y and target Y
  double offY;

  /// @brief Theta Offset. Angular distance between current theta and target theta
  std::optional<double> offT = std::nullopt;

  /// @brief Time remaining before the waypoint times out
  std::optional<uint32_t> remainingTimeout = std::nullopt;

  /// @brief True if the waypoint has been reached within tolerances
  bool reached;

  /// @brief True if the waypoint has timed out
  std::optional<bool> timedOut = std::nullopt;
};

/**
 * @class WaypointHandle
 * @brief A handle to a waypoint. Returned from logger.addWaypoint(). 
*/
class WaypointHandle {
private:
  /// ID of the waypoint
  WPId m_id; 
  friend class Logger; 
  explicit WaypointHandle(WPId id) : m_id(id) {}

public:
  /** 
   * @brief Get the offset of the robot from the waypoint
   * \return Returns the offset of the waypoint in WaypointOffset struct
  */
  WaypointOffset getOffset() const;

  /**
   * @brief Get the params of the waypoint
   * \return Returns the parameters of the waypoint
  */
  WaypointParams getParams() const;

  /**
   * @brief Get the name of the waypoint
   * \return Returns the name of the waypoint
  */
  std::string getLabel() const;

  /** 
   * @brief Check if the robot has reached the waypoint
   * \return Returns true if the robot has reached the waypoint
  */
  bool reached() const;

  /** 
   * @brief Check if the waypoint has timed out
   * \return Returns true if the waypoint has timed out
  */
  bool timedOut() const;

  /** 
   * @brief Check if the waypoint is active, meaning it is being
   *        tracked, printed if needed, and watched for 
   *        timeouts/being reached.
   * \return Returns true if the waypoint is active
  */
  bool active() const;

  /**
   * @brief Re-send this waypoint's roster entry over telemetry.
   * \return Returns true if the waypoint exists and was re-sent.
  */
  bool resyncRoster() const;
};
}
