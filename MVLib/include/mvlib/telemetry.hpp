#pragma once
#include "core.hpp"
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <string>

namespace mvlib {

inline constexpr std::size_t kTelemetryMaxTextBytes = 511;

/**
 * @enum MsgType
 * @brief Identifies the binary packet type for the MotionView decoder.
 */
enum class MsgType : uint8_t {
    POSE   = 0x01, // High-speed drivetrain/position
    WPOINT = 0x02, // Waypoint state changes/offsets
    WATCH  = 0x03, // Variable watches (numeric)
    ROSTER = 0x04, // ID-to-Name mapping (The "Late Joiner" fix)
    LOG    = 0x05  // Standard text-based logs
};

/**
 * @brief [TTT LLL SS] -> Type (3b), Level (3b), SubType (2b)
 */
static constexpr uint8_t encodeMsgAll(LogLevel lvl, MsgType type, uint8_t subType = 0) {
  uint8_t t = (static_cast<uint8_t>(type) & 0x07) << 5;
  uint8_t rawLvl = static_cast<uint8_t>(lvl);
  uint8_t l = ((rawLvl == 0xFF ? 0x07 : rawLvl) & 0x07) << 2;
  return t | l | (subType & 0x03);
}

double normalizeDegrees360(double degrees);
uint16_t packTelemetryTheta(double degrees);
int8_t packTelemetryVelocity(double velocity);

// Optimized Packets
struct __attribute__((packed)) PosePacket {
  uint16_t timestamp;
  float x; 
  float y;
  uint16_t theta;
  int8_t leftVel; 
  int8_t rightVel;
};

struct __attribute__((packed)) WaypointCreatedPacket {
  uint16_t timestamp;
  uint16_t id;
  float tarX, tarY;
  uint16_t tarT;
  float linTol, thetaTol;
  uint32_t timeout;
};

struct __attribute__((packed)) WaypointStatusPacket {
  uint16_t timestamp;
  uint16_t id;
};

struct __attribute__((packed)) WatchPacket {
  uint16_t timestamp;
  uint16_t id;
  float value;
};

struct __attribute__((packed)) WatchTextPacketHeader {
  uint16_t timestamp;
  uint16_t id;
};

struct __attribute__((packed)) RosterPacket {
  uint16_t id;
  char name[24];
};

struct __attribute__((packed)) LogPacketHeader {
  uint16_t timestamp;
};

static_assert(sizeof(PosePacket) == 14, "PosePacket layout changed");
static_assert(sizeof(WaypointCreatedPacket) == 26, "WaypointCreatedPacket layout changed");
static_assert(sizeof(WaypointStatusPacket) == 4, "WaypointStatusPacket layout changed");
static_assert(sizeof(WatchPacket) == 8, "WatchPacket layout changed");
static_assert(sizeof(WatchTextPacketHeader) == 4, "WatchTextPacketHeader layout changed");
static_assert(sizeof(RosterPacket) == 26, "RosterPacket layout changed");
static_assert(sizeof(LogPacketHeader) == 2, "LogPacketHeader layout changed");

class Telemetry {
public:
  static Telemetry& getInstance();
  void setMinLevel(LogLevel level);
  bool shouldLog(LogLevel level) const;

  void sendPose(const PosePacket& pkt);
  void sendWaypointCreated(const WaypointCreatedPacket& pkt);
  void sendWaypointStatus(WPId id, uint8_t subType); // 2=Reached, 3=TimedOut
  void sendWatch(WatchId id, LogLevel lvl, float val, bool tripped);
  void sendWatchText(WatchId id, LogLevel lvl, const std::string& text, bool tripped);
  void sendRoster(uint16_t id, const std::string& name, bool isElevated = false);
  void sendLog(LogLevel level, const char* fmt, ...);
  void notifyTransmitTask();

private:
  Telemetry(LogLevel minLevel = LogLevel::INFO);
  Telemetry(const Telemetry&) = delete;
  Telemetry& operator=(const Telemetry&) = delete;

  LogLevel m_minLevel;
  std::unique_ptr<pros::Task> m_transmitHandleTask = nullptr;
  void writeFrameDirect(const uint8_t* data, size_t len);
  void transmit(uint8_t header, const uint8_t* data, size_t len); // Use raw header
};
} // namespace mvlib
