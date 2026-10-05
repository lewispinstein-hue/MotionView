/**
 * @file decoderTest.cpp
 * @brief Hardware fixture for exercising the complete MotionView serial decoder.
 *
 * Copy this file over `src/main.cpp` in an MVLib-enabled PROS project, deploy,
 * and attach MotionView before the program starts. It requires no motors,
 * sensors, or controller input.
 *
 * The fixture deliberately produces:
 * - a START frame followed by samples that arrive before their watch rosters;
 * - DEBUG, INFO, WARN, and ERROR log records;
 * - numeric, text, boolean, and predicate/elevated-label watches;
 * - waypoint CREATED, REACHED, and TIMEDOUT records; and
 * - a changing pose stream for 68 seconds, which crosses the uint16_t
 *   timestamp rollover at 65.536 seconds.
 *
 * It is a deployable device fixture rather than a host-side unit test. The
 * expected decoder behavior is documented next to each phase so a captured
 * terminal stream can also be replayed through decoder tests later.
 */

#include "main.h"

#define MVLIB_USE_SIMPLES
#include "mvlib/api.hpp"
#include "mvlib/Optional/customOdom.hpp"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>

namespace {

struct FixtureState {
  pros::Mutex mutex;
  mvlib::Pose pose{0.0, 0.0, 0.0};
  int32_t numericValue = 0;
  bool enabled = false;
  std::string phase{"boot"};
};

FixtureState g_state;
std::unique_ptr<pros::Task> g_fixtureTask;

template <class Read>
auto readState(Read&& read) {
  g_state.mutex.take(TIMEOUT_MAX);
  auto value = read(g_state);
  g_state.mutex.give();
  return value;
}

template <class Update>
void updateState(Update&& update) {
  g_state.mutex.take(TIMEOUT_MAX);
  update(g_state);
  g_state.mutex.give();
}

std::optional<mvlib::Pose> decoderFixturePose() {
  return readState([](const FixtureState& state) { return state.pose; });
}

void runDecoderFixture() {
  auto& logger = mvlib::Logger::getInstance();

  // These are intentionally registered after start(). They must emit both a
  // roster and a CREATED packet, and exercise distance, heading, and timeout
  // fields in the decoder.
  const auto reached = logger.addWaypoint("Decoder Reached", {
    .tarX = 24.0,
    .tarY = -8.0,
    .tarT = 90.0,
    .timeoutMs = 8_mvS,
    .linearTol = 0.25F,
    .thetaTol = 2.0F,
  });
  const auto timedOut = logger.addWaypoint("Decoder Timeout", {
    .tarX = 300,
    .tarY = 300,
    .timeoutMs = 2_mvS,
    .linearTol = 0.25,
  });

  // Re-sending also makes the fixture useful when MotionView attaches just
  // after startup rather than before it.
  reached.resyncRoster();
  timedOut.resyncRoster();

  logger.info("Decoder fixture: scripted run has started");
  pros::delay(450);

  // The next MVLib update sees this pose and emits REACHED for the first
  // waypoint. The second cannot be reached and emits TIMEDOUT after 2 s.
  updateState([](FixtureState& state) {
    state.pose = {24.0, -8.0, 90.0};
    state.numericValue = 750;
    state.enabled = true;
    state.phase = "reached";
  });
  logger.warn("Decoder fixture: entered elevated watch range");

  pros::delay(2300);
  updateState([](FixtureState& state) {
    state.pose = {30.0, -4.0, 135.0};
    state.numericValue = 2750;
    state.phase = "timeout";
  });
  logger.error("Decoder fixture: timeout waypoint should now be inactive");

  // Continue long enough to emit 16-bit timestamps on both sides of the
  // 65.536-second boundary. The START frame makes a *program restart*
  // distinguishable from this ordinary rollover.
  const uint32_t loopStart = pros::millis();
  bool announcedRollover = false;
  while (pros::millis() - loopStart < 68_mvS) {
    const uint32_t elapsed = pros::millis() - loopStart;
    const int32_t sample = static_cast<int32_t>(elapsed % 3001);

    updateState([elapsed, sample](FixtureState& state) {
      state.numericValue = sample;
      state.enabled = (elapsed / 1000) % 2 == 0;
      state.phase = state.enabled ? "streaming" : "paused";
      state.pose = {
        30.0 + static_cast<double>(elapsed % 4000) / 200.0,
        -4.0 + static_cast<double>(elapsed % 2000) / 250.0,
        static_cast<double>((135 + elapsed / 20) % 360),
      };
    });

    if (!announcedRollover && pros::millis() >= UINT16_MAX) {
      announcedRollover = true;
      logger.info("Decoder fixture: crossed uint16 timestamp rollover");
    }
    pros::delay(20);
  }

  updateState([](FixtureState& state) {
    state.numericValue = 0;
    state.enabled = false;
    state.phase = "complete";
  });
  logger.info("Decoder fixture: completed; telemetry remains live");
}

} // namespace

void initialize() {
  auto& logger = mvlib::Logger::getInstance();

  // Keep this fixture terminal-only and make every log level observable.
  logger.setLogToSD(false);
  logger.setLogSystemInfo(false);
  logger.setMinLogLevel(LogLevel::DEBUG);
  logger.setTimings({
    .stdoutBufferFlushInterval = 100,
    .terminalPollingRate = 50,
    .rosterSyncAllInterval = 500,
  });

  mvlib::setOdom(decoderFixturePose);

  // Register before start so the forced samples below precede their rosters.
  // That confirms the decoder buffers samples until it learns the ID mapping.
  auto numberWatch = logger.watch(
    "Decoder Number", LogLevel::INFO, WatchMode::onInterval, 80_mvMs,
    [] { return readState([](const FixtureState& state) { return state.numericValue; }); },
    mvlib::LevelOverride<int32_t>{
      .elevatedLevel = LogLevel::WARN,
      .predicate = mvlib::asPredicate<int32_t>([](const int32_t& value) {
        return value >= 2500;
      }),
      .label = "Decoder High Number",
    });
  auto textWatch = logger.watch(
    "Decoder Phase", LogLevel::INFO, WatchMode::onChange, 50_mvMs,
    [] { return readState([](const FixtureState& state) { return state.phase; }); });
  auto boolWatch = logger.watch(
    "Decoder Enabled", LogLevel::DEBUG, WatchMode::onChange, 50_mvMs,
    [] { return readState([](const FixtureState& state) { return state.enabled; }); });

  // Logger::start() emits START before every other telemetry frame.
  logger.start();
  logger.debug("Decoder fixture: debug log");
  logger.info("Decoder fixture: info log");
  logger.warn("Decoder fixture: warning log");
  logger.error("Decoder fixture: error log");

  // These records intentionally precede ROSTER packets. A correct decoder
  // holds them briefly and then associates them with the names below.
  numberWatch.evaluate(true);
  textWatch.evaluate(true);
  boolWatch.evaluate(true);
  pros::delay(100);
  logger.resyncAllWatchesRoster();

  g_fixtureTask = std::make_unique<pros::Task>(runDecoderFixture,
                                                TASK_PRIORITY_DEFAULT,
                                                TASK_STACK_DEPTH_DEFAULT,
                                                "MVLib Decoder Test");
}

void disabled() {}
void competition_initialize() {}
void autonomous() {}

void opcontrol() {
  // All fixture activity is performed by the dedicated task so this remains
  // valid with or without a competition switch attached.
  while (true) pros::delay(100);
}
