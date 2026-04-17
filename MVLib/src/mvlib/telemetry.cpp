#include "mvlib/telemetry.hpp"
#include "core.hpp"
#include "pros/rtos.hpp"
#include "pros/apix.h"
#include <algorithm>
#include <array>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <unistd.h>

namespace mvlib {
namespace {
constexpr size_t kTelemetryMaxPayloadBytes =
  std::max(sizeof(LogPacketHeader), sizeof(WatchTextPacketHeader)) + kTelemetryMaxTextBytes;
constexpr size_t kTelemetryMaxRawFrameBytes = kTelemetryMaxPayloadBytes + 1;
constexpr size_t kTelemetryMaxEncodedFrameBytes =
  kTelemetryMaxRawFrameBytes + (kTelemetryMaxRawFrameBytes / 254) + 2;

constexpr size_t kTelemetryQueueCapacity = 64;
constexpr uint32_t kTelemetryQueueLockTimeoutMs = 2;
constexpr uint32_t kTelemetryWriteRetryDelayMs = 15;
constexpr size_t kTelemetryMaxWriteRetries = 8;

constexpr uint32_t kTelemetryWaitForDataTimeoutMs = 12;

struct TelemetryFrame {
  std::array<uint8_t, kTelemetryMaxEncodedFrameBytes> bytes{};
  size_t len{0};
};

std::array<TelemetryFrame, kTelemetryQueueCapacity> telemetryQueue{};
size_t telemetryQueueHead = 0;
size_t telemetryQueueTail = 0;
size_t telemetryQueueCount = 0;
pros::Mutex telemetryQueueMutex;
pros::Mutex telemetryWriteMutex;

bool enqueueTelemetryFrame(const uint8_t *data, size_t len) {
  if (!telemetryQueueMutex.take(kTelemetryQueueLockTimeoutMs)) return false;

  const bool hasCapacity = telemetryQueueCount < kTelemetryQueueCapacity;
  if (hasCapacity) {
    auto& slot = telemetryQueue[telemetryQueueTail];
    memcpy(slot.bytes.data(), data, len);
    slot.len = len;
    telemetryQueueTail = (telemetryQueueTail + 1) % kTelemetryQueueCapacity;
    ++telemetryQueueCount;
  }

  telemetryQueueMutex.give();

  // If we successfully added a frame, wake up the background tasks
  if (hasCapacity) {
    mvlib::Telemetry::getInstance().notifyTransmitTask();
  }

  return hasCapacity;
}

bool dequeueTelemetryFrame(TelemetryFrame& frame) {
  if (!telemetryQueueMutex.take()) return false;

  const bool hasFrame = telemetryQueueCount > 0;
  if (hasFrame) {
    frame = telemetryQueue[telemetryQueueHead];
    telemetryQueueHead = (telemetryQueueHead + 1) % kTelemetryQueueCapacity;
    --telemetryQueueCount;
  }

  telemetryQueueMutex.give();
  return hasFrame;
}

void writeFrameBlocking(const uint8_t * data, size_t len) {
  telemetryWriteMutex.take();
  size_t totalWritten = 0;
  size_t retryCount = 0;
  while (totalWritten < len) {
    int result = write(1, data + totalWritten, len - totalWritten);
    if (result <= 0) {
      if (++retryCount >= kTelemetryMaxWriteRetries) break;
      pros::delay(kTelemetryWriteRetryDelayMs);
      continue;
    }
    retryCount = 0;
    totalWritten += static_cast<size_t>(result);
  }
  telemetryWriteMutex.give();
}
} // namespace

Telemetry& Telemetry::getInstance() {
  static Telemetry instance;
  return instance;
}

void Telemetry::setMinLevel(LogLevel level) {
  m_minLevel = level;
}

bool Telemetry::shouldLog(LogLevel level) const {
  if (level == LogLevel::OVERRIDE) return true;
  if (m_minLevel == LogLevel::OFF || m_minLevel == LogLevel::NONE) return false;

  // Casting to uint8_t ensures numeric comparison works for LogLevel enum
  return static_cast<uint8_t>(level) >= static_cast<uint8_t>(m_minLevel);
}

// --- High-Level Senders ---

void Telemetry::sendPose(const PosePacket& pkt) {
  // Pose is high-priority system data, so it gets OVERRIDE level
  transmit(encodeMsgAll(LogLevel::OVERRIDE, MsgType::POSE),
           reinterpret_cast<const uint8_t *>(&pkt), sizeof(PosePacket));
}

void Telemetry::sendWaypointCreated(const WaypointCreatedPacket& pkt) {
  // SubType 1 = Created
  transmit(encodeMsgAll(LogLevel::OVERRIDE, MsgType::WPOINT, 1), 
           reinterpret_cast<const uint8_t *>(&pkt), sizeof(WaypointCreatedPacket));
}

void Telemetry::sendWaypointStatus(WPId id, uint8_t subType) {
  if (subType < 2 || subType > 3) return;

  // Construct minimal packet for Reached (2) or TimedOut (3)
  WaypointStatusPacket pkt;
  pkt.timestamp = static_cast<uint16_t>(pros::millis());
  pkt.id = id;
  
  transmit(encodeMsgAll(LogLevel::OVERRIDE, MsgType::WPOINT, subType), 
           reinterpret_cast<const uint8_t *>(&pkt), sizeof(WaypointStatusPacket));
}

void Telemetry::sendWatch(WatchId id, LogLevel lvl, float val, bool tripped) {
  if (!shouldLog(lvl)) return;

  WatchPacket pkt;
  pkt.timestamp = static_cast<uint16_t>(pros::millis());
  pkt.id = id;
  pkt.value = val;
  
  // SubType 1 indicates the watch predicate was tripped (elevated)
  transmit(encodeMsgAll(lvl, MsgType::WATCH, tripped ? 1 : 0), 
           reinterpret_cast<const uint8_t *>(&pkt), sizeof(WatchPacket));
}

void Telemetry::sendWatchText(WatchId id, LogLevel lvl, const std::string& text, bool tripped) {
  if (!shouldLog(lvl)) return;

  WatchTextPacketHeader header;
  header.timestamp = static_cast<uint16_t>(pros::millis());
  header.id = id;

  const size_t textLen = std::min(text.size(), kTelemetryMaxTextBytes);
  const size_t totalPayloadSize = sizeof(WatchTextPacketHeader) + textLen;
  std::array<uint8_t, kTelemetryMaxPayloadBytes> payload{};

  memcpy(payload.data(), &header, sizeof(WatchTextPacketHeader));
  memcpy(payload.data() + sizeof(WatchTextPacketHeader), text.data(), textLen);

  // SubType 2 = textual watch sample, SubType 3 = textual watch sample with tripped predicate.
  transmit(encodeMsgAll(lvl, MsgType::WATCH, tripped ? 3 : 2), payload.data(), totalPayloadSize);
}

void Telemetry::sendRoster(uint16_t id, const std::string& name, bool isElevated) {
  RosterPacket pkt;
  pkt.id = id;
  memset(pkt.name, 0, sizeof(pkt.name));
  strncpy(pkt.name, name.c_str(), sizeof(pkt.name) - 1);
  
  // SubType 1 indicates this is the secondary/elevated label for the ID
  transmit(encodeMsgAll(LogLevel::OVERRIDE, MsgType::ROSTER, isElevated ? 1 : 0), 
           reinterpret_cast<const uint8_t *>(&pkt), sizeof(RosterPacket));
}

void Telemetry::sendLog(LogLevel level, const char *fmt, ...) {
  if (!shouldLog(level)) return;

  // 1. Format the string
  std::array<char, kTelemetryMaxTextBytes + 1> textBuf{};
  va_list args;
  va_start(args, fmt);
  int textLen = vsnprintf(textBuf.data(), textBuf.size(), fmt, args);
  va_end(args);

  if (textLen < 0) return;
  if (textLen >= static_cast<int>(textBuf.size())) {
    textLen = static_cast<int>(textBuf.size()) - 1;
  }

  // 2. Prepare the binary frame (16-bit Timestamp Header + String)
  LogPacketHeader header;
  header.timestamp = static_cast<uint16_t>(pros::millis());

  const size_t totalPayloadSize = sizeof(LogPacketHeader) + static_cast<size_t>(textLen);
  std::array<uint8_t, kTelemetryMaxPayloadBytes> payload;

  memcpy(payload.data(), &header, sizeof(LogPacketHeader));
  memcpy(payload.data() + sizeof(LogPacketHeader), textBuf.data(), static_cast<size_t>(textLen));

  transmit(encodeMsgAll(level, MsgType::LOG), payload.data(), totalPayloadSize);
}

// The background consumer task
void telemetryIoTask(void *ignore) {
  (void)ignore;
  // A local buffer to batch multiple frames into one VEXos payload
  std::array<uint8_t, 512> batchBuffer{};
  size_t batchLen = 0;

  auto flushBatch = [&]() {
    if (batchLen > 0) {
      writeFrameBlocking(batchBuffer.data(), batchLen);
      batchLen = 0;
    }
  };

  while (true) {
    // Wait up to Xms. If we time out, flush whatever is waiting.
    // This gives Update() time to queue multiple frames back-to-back.
    uint32_t notified = pros::Task::notify_take(true, kTelemetryWaitForDataTimeoutMs);

    TelemetryFrame frame;
    while (dequeueTelemetryFrame(frame)) {
      // If adding this frame overflows the batch, flush the batch first
      if (batchLen + frame.len > batchBuffer.size()) {
        flushBatch();
      }
      memcpy(batchBuffer.data() + batchLen, frame.bytes.data(), frame.len);
      batchLen += frame.len;
    }

    // Flush if we timed out (no recent data arriving) 
    // OR if the batch is getting large enough to be efficient over the radio
    if (!notified || batchLen >= 128) {
      flushBatch();
    }
  }
}

Telemetry::Telemetry(LogLevel minLevel) : m_minLevel(minLevel) {
  m_transmitHandleTask = std::make_unique<pros::Task>(
    telemetryIoTask,
    nullptr,
    TASK_PRIORITY_DEFAULT - 1,
    TASK_STACK_DEPTH_DEFAULT,
    "MVLib TelemetryIO Handler"
  );
}

void Telemetry::notifyTransmitTask() {
  if (!m_transmitHandleTask) return;
  m_transmitHandleTask->notify();
}

void Telemetry::writeFrameDirect(const uint8_t * data, size_t len) {
  writeFrameBlocking(data, len);
}

/**
 * Consistent Overhead Byte Stuffing (COBS)
 * Prevents 0x00 bytes in the data stream by using them as frame delimiters.
 */
void Telemetry::transmit(uint8_t header, const uint8_t *data, size_t len) {
  if (data == nullptr || len > kTelemetryMaxPayloadBytes) return;

  // Uninitialized buffer for speed
  std::array<uint8_t, kTelemetryMaxEncodedFrameBytes> encodedBuf;

  // Virtual zero-copy accessor
  auto getRawByte = [&](size_t index) -> uint8_t {
    return (index == 0) ? header : data[index - 1];
  };

  const size_t rawLen = len + 1;
  size_t writePos = 1;
  size_t codePos = 0;
  uint8_t code = 1;

  for (size_t i = 0; i < rawLen; ++i) {
    uint8_t currentByte = getRawByte(i);
    if (currentByte == 0) {
      encodedBuf[codePos] = code;
      codePos = writePos++;
      code = 1;
    } else {
      encodedBuf[writePos++] = currentByte;
      code++;
      if (code == 0xFF) {
        encodedBuf[codePos] = code;
        codePos = writePos++;
        code = 1;
      }
    }
  }
  encodedBuf[codePos] = code;
  encodedBuf[writePos++] = 0x00; // Final Delimiter

  // If the queue is full, drop the packet rather than stalling the control loop.
  enqueueTelemetryFrame(encodedBuf.data(), writePos);
}
} // namespace mvlib
