#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include <cstdarg>
#include <cstring>
#include <cmath>
#include <utility>

#ifdef MVLIB_LOGS_REDEFINED
#define LOG_DEBUG MVLIB_LOG_DEBUG
#define LOG_INFO MVLIB_LOG_INFO
#define LOG_WARN MVLIB_LOG_WARN
#define LOG_ERROR MVLIB_LOG_ERROR
#define LOG_FATAL MVLIB_LOG_FATAL
#endif

namespace mvlib {

Logger &Logger::getInstance() {
  static Logger instance;
  return instance;
}

void Logger::setLogToTerminal(bool v) {
  m_config.logToTerminal.store(v);
  LOG_DEBUG("logToTerminal set to: %d", v);
}

void Logger::setLogToSD(bool v) {
  if (m_started || m_sdLocked) {
    LOG_WARN("setLogToSD() called after logger start — ignored. Set value: %d",
             v);
    return;
  }
  m_config.logToSD.store(v);
  LOG_DEBUG("logToSD set to: %d", v);
}

void Logger::setPrintWatches(bool v) {
  m_config.printWatches.store(v);
  LOG_DEBUG("printWatches set to: %d", v);
}

void Logger::setLoggerMinLevel(LogLevel level) {
  m_minLogLevel = level;
  LOG_DEBUG("SetLoggerMinLevel set to: %d", (int)level);
}

void Logger::setPoseGetter(std::function<std::optional<Pose>()> getter) {
  MutexGuard m(m_generalMutex, TIMEOUT_MAX);
  if (!m.isLocked())
    return;
  m_getPose = std::move(getter);
}

bool Logger::setRobot(Drivetrain drivetrain) {
  if (m_configSet) {
    LOG_WARN("setRobot(Drivetrain) called twice!");
    return false;
  }
  m_configSet = true;

  if (!drivetrain.LeftDrivetrain || !drivetrain.RightDrivetrain) {
    LOG_FATAL("setRobot(Drivetrain) called with nullptr drivetrain arguments!");
    return false;
  }

  m_pLeftDrivetrain = drivetrain.LeftDrivetrain;
  m_pRightDrivetrain = drivetrain.RightDrivetrain;

  LOG_INFO("setRobot() successfully set variables!");
  return true;
}

const char *Logger::m_levelToString(LogLevel level) const {
  switch (level) {
  case LogLevel::DEBUG: return "DEBUG";
  case LogLevel::INFO:  return "INFO";
  case LogLevel::WARN:  return "WARN";
  case LogLevel::ERROR: return "ERROR";
  case LogLevel::FATAL: return "FATAL";
  default:              return "UNKNOWN";
  }
  UNREACHABLE();
}

void Logger::logMessage(LogLevel level, const char *fmt, ...) {
  if (level < m_minLogLevel)
    return;

  MutexGuard m(m_loggerMutex);
  if (!m.isLocked())
    return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  double time = pros::millis() / 1000.0;

  if (m_config.logToTerminal.load())
    printf("[%.2f] [%s]: %s\n", time, m_levelToString(level), buffer);

  if (m_config.logToSD.load()) 
    logToSD(m_levelToString(level), "%s", buffer);
}

void Logger::m_makeTimestampedFilename() {
  time_t now = time(0);
  struct tm *tstruct = localtime(&now);

  if (tstruct->tm_year < 100) {
    printf("[DEBUG]: VEX RTC Inaccurate. Falling back to program duration and last upload date.\n");
    snprintf(m_currentFilename, sizeof(m_currentFilename), "/usd/%s_%u-%u.log",
             date, pros::millis() / 1000, pros::millis());
  } else {
    printf("[DEBUG]: VEX RTC Plausible. Creating file name with date.\n");
    strftime(m_currentFilename, sizeof(m_currentFilename),
             "/usd/%Y-%m-%d_%H-%M.log", tstruct);
  }
}

bool Logger::m_initSDLogger() {
  if (pros::usd::is_installed()) {
    printf("[DEBUG]: SD Card installed (On first attempt)\n");
    pros::delay(500);
  } else {
    printf("[DEBUG]: SD Card not installed, rechecking...\n");
    for (int i = 0; i < 10; i++) {
      if (pros::usd::is_installed()) {
        printf("[DEBUG]: SD Card installed! Attempt: %d/10\n", i);
        break;
      }
      printf("[DEBUG]: Rechecking SD card installment... Attempts: %d/10\n", i);
      pros::delay(200);
    }
  }

  if (!pros::usd::is_installed()) {
    printf("[DEBUG]: SD Card not installed after 10 attemps. Aborting SD card.\n");
    return false;
  }

  m_makeTimestampedFilename();

  m_sdFile = fopen(m_currentFilename, "w");
  if (!m_sdFile) {
    printf("[DEBUG]: File could not be opened. Aborting.\n");
    return false;
  }
  printf("[DEBUG]: File successfully opened.\n");
  fprintf(m_sdFile, "=== Logger initialized at %.2fs ===\n",
          pros::millis() / 1000.0);
  fflush(m_sdFile);
  return true;
}

void Logger::logToSD(const char *levelStr, const char *fmt, ...) {
  if (!m_sdFile) {
    return;
  }

  MutexGuard m(m_logToSdMutex);
  if (!m.isLocked())
    return;

  fprintf(m_sdFile, "[%.2f] [%s]: ", pros::millis() / 1000.0, levelStr);

  va_list args;
  va_start(args, fmt);
  vfprintf(m_sdFile, fmt, args);
  va_end(args);

  fprintf(m_sdFile, "\n");

  bool isError =
      (strcmp(levelStr, "ERROR") == 0 || strcmp(levelStr, "FATAL") == 0);

  if (isError || (pros::millis() - m_lastFlush >= SD_FLUSH_INTERVAL_MS)) {
    fflush(m_sdFile);
    m_lastFlush = pros::millis();
  }
}

bool Logger::m_checkRobotConfig() {
  MutexGuard m(m_generalMutex, TIMEOUT_MAX);

  bool allValid = true;

  if (m_pLeftDrivetrain.get() == nullptr) {
    LOG_FATAL("Left Drivetrain pointer is NULL!\n");
    allValid = false;
  }
  if (m_pRightDrivetrain.get() == nullptr) {
    LOG_FATAL("Right Drivetrain pointer is NULL!\n");
    allValid = false;
  }

  return allValid;
}

uint32_t Logger::status() const {
  if (!m_task)
    return pros::E_TASK_STATE_INVALID;
  return m_task->get_state();
}

void Logger::pause() {
  uint32_t st = status();
  if (st != pros::E_TASK_STATE_DELETED && st != pros::E_TASK_STATE_INVALID &&
      st != pros::E_TASK_STATE_SUSPENDED && st != pros::E_TASK_STATE_BLOCKED) {
    m_task->suspend();
  } else {
    LOG_INFO("Logger cannot be paused as it is not in a running state.");
  }
}

void Logger::unpause() {
  uint32_t st = status();
  if (st != pros::E_TASK_STATE_DELETED && st != pros::E_TASK_STATE_INVALID &&
      st == pros::E_TASK_STATE_SUSPENDED && st != pros::E_TASK_STATE_BLOCKED) {
    m_task->resume();
  } else {
    LOG_INFO("Logger cannot be unpaused as it is not paused.");
  }
}

void Logger::start() {
  if (m_started) {
    LOG_WARN("Function: start() called a second time! Function aborted.\n");
    return;
  }
  m_started = true;

  // SD init happens here.
  if (m_config.logToSD.load() && m_sdFile == nullptr) {
    bool success = m_initSDLogger();
    if (!success) {
      m_config.logToSD.store(false);
      m_sdLocked = true;
      LOG_FATAL("initSDCard failed! Unable to initialize SD card.\n");
    } else {
      LOG_INFO("Successfully initialized SD card!\n");
    }
  }
    
    // Check config
    m_configValid = m_checkRobotConfig();
    if (!m_configValid) LOG_FATAL("At least one pointer set by setRobot(Drivetrain ref) is nullptr. Not logging speed!\n");
    else LOG_INFO("All pointers set by setRobot(Drivetrain ref) seem to be valid.");

  // Create task that runs Update
  m_task = std::make_unique<pros::Task>(
      [this]() mutable {
        pros::delay(200);
        // Wait for controller RX settle
        if (m_config.logToTerminal.load())
          pros::delay(1000);

        while (true) {
          // norm is used in Update() via re-computation; kept for
          // capture symmetry.
          this->Update();
          // Flush buffer
          fflush(stdout);
          // Wait appropriate time
          if (m_config.logToTerminal.load()) {
            pros::delay(terminalPollingRate);
          } else {
            pros::delay(sdCardPollingRate);
          }
        }
      },
      TASK_PRIORITY_DEFAULT, TASK_STACK_DEPTH_DEFAULT, "mvlib Logger");
}

void Logger::printWatches() {
  uint32_t nowMs = pros::millis();
  for (auto &[id, w] : m_watches) {
    // Gate evaluation frequency for ALL watches
    if (!w.onChange && w.lastPrintMs != 0 &&
        (nowMs - w.lastPrintMs) < w.intervalMs) {
      continue;
    }

    if (!w.eval)
      continue;

    auto [lvl, valueStr, overrideLabel] = w.eval();

    if (w.onChange) {
      if (w.lastValue && *w.lastValue == valueStr) {
        continue;
      }
      w.lastValue = valueStr;
    }

    std::string label;
    std::string finalOutput;

    // Only add override label if present
    if (!overrideLabel.empty())
      label = overrideLabel;

    // Add watch tag and add comma separators
    finalOutput = std::string("[WATCH],") +
                  std::to_string(nowMs) + 
                  "," + m_levelToString(lvl) 
                  +  "," + label + "," + valueStr;

    if (!w.onChange) {
      w.lastPrintMs = nowMs;
    }

    switch (lvl) {
    case LogLevel::DEBUG: LOG_DEBUG("%s", finalOutput.c_str()); break;
    case LogLevel::INFO:  LOG_INFO("%s", finalOutput.c_str());  break;
    case LogLevel::WARN:  LOG_WARN("%s", finalOutput.c_str());  break;
    case LogLevel::ERROR: LOG_ERROR("%s", finalOutput.c_str()); break;
    default: LOG_INFO("%s", finalOutput.c_str()); break;
    }
    return;
  }
  UNREACHABLE();
}

void Logger::Update() {
  if (m_config.printWatches.load()) 
    printWatches();

  if (m_configValid && m_configSet) {
    static pros::MotorGears drivetrainGearset =
        m_pLeftDrivetrain.get() ? 
        m_pLeftDrivetrain.get()->get_gearing() : pros::MotorGears::invalid;
                      
    static double divideFactorDrivetrainRPM = 1;
    switch (drivetrainGearset) {
      case pros::MotorGears::rpm_100: divideFactorDrivetrainRPM = 100.0; break;
      case pros::MotorGears::rpm_200: divideFactorDrivetrainRPM = 200.0; break;
      case pros::MotorGears::rpm_600: divideFactorDrivetrainRPM = 600.0; break;
      default:                        divideFactorDrivetrainRPM = 300.0;
    }

    static auto norm = [&](double rpm) {
      double v = (rpm / divideFactorDrivetrainRPM) * 127.0;
      if (v > 127)
        v = 127;
      if (v < -127)
        v = -127;
      return v;
    };

    if (m_getPose) {
      auto pose = m_getPose();
      if (!pose)
        return;
      float normalizedTheta = fmod(pose->theta, 360.0); // Normalize theta 
      if (normalizedTheta < 0)
        normalizedTheta += 360.0;

    LOG_INFO("[DATA],%d,%.2f,%.2f,%.2f,%.1f,%.1f", 
            pros::millis(), pose->x, pose->y, normalizedTheta,
            norm(m_pLeftDrivetrain.get()->get_actual_velocity()),
            norm(m_pRightDrivetrain.get()->get_actual_velocity()));
    }
  }
}
} // namespace mvlib
