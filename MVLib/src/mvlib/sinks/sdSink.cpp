#include "mvlib/private/telemetry.hpp"
#include "mvlib/private/raii.hpp"
#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "pros/misc.hpp"
#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include <cstdarg>
#include <cstdint>
#include <cstring>
#include <random>
#include <cerrno>
#include <time.h>
#include <algorithm>
#include <string_view>

namespace mvlib {
namespace {
enum class FolderCheckResult : uint8_t {
  success,
  notFound,
  unknownError
};

constexpr uint64_t recentEpochTime = 1781602800;

uint32_t getrandInt(const uint32_t min, const uint32_t max) {
  /**
   * @note This method of generation is needed because the v5 brain is 
   *       completely deterministic. Using std::rand or std::random_device
   *       results in the same number every time.
   */

  uint64_t seed = pros::micros();
  seed ^= (uint64_t)pros::battery::get_voltage() << 32;
  seed ^= [&]() mutable -> uint64_t {
    seed += 0x9e3779b97f4a7c15ULL;
    uint64_t z = seed;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
  }();
  seed ^= std::chrono::system_clock::now().time_since_epoch().count();

  std::mt19937 gen(seed);
  std::uniform_int_distribution<> dis(min, max);
  return dis(gen);
}

bool isLocationFolder(const std::string_view absolutePath, char separator = '/') {
  if (absolutePath.empty()) return false;
  const bool containsNoFilenames = absolutePath.find('.') == std::string_view::npos;
  const size_t slashCount = static_cast<size_t>(std::count(absolutePath.begin(),
                                                           absolutePath.end(),
                                                           separator));
  return containsNoFilenames && slashCount > 0;
}

void trimTrailingSeparator(std::string& path, char separator = '/') {
  while (path.size() > 1 && path.back() == separator) {
    path.pop_back();
  }
}

std::string toPosixPath(const std::string_view path) {
  std::string normalized(path);
  std::replace(normalized.begin(), normalized.end(), '\\', '/');
  return normalized;
}

std::string getFilenameFromPath(const std::string_view path, char separator = '/') {
  if (path.empty()) return {};
  const size_t lastSlash = path.find_last_of(separator);
  if (lastSlash == std::string_view::npos) return std::string(path);
  return std::string(path.substr(lastSlash + 1));
}

std::string getDirectoryFromPath(const std::string_view path, char separator = '/') {
  if (path.empty()) return {};
  if (path.back() == separator) return std::string(path);

  const size_t lastSlash = path.find_last_of(separator);
  if (lastSlash == std::string_view::npos) return {};
  // Only root-level folder like "/folder"
  if (lastSlash == 0) return std::string(1, separator);

  return std::string(path.substr(0, lastSlash));
}

std::string joinPath(const std::string_view folder, const std::string_view basename) {
  if (basename.empty()) return std::string(folder);
  if (folder.empty() || folder == "/") return std::string("/") + std::string(basename);
  std::string path(folder);
  path += "/";
  path += basename;
  return path;
}

bool doesFileExist(const std::string_view relativePath) {
  if (relativePath.empty()) return false;
  const std::string fullPath = "/usd" + std::string(relativePath);
  if (FILE* file = fopen(fullPath.c_str(), "r")) {
    fclose(file);
    return true;
  }
  return false;
}

FolderCheckResult checkFolderExists(const std::string_view relativeFolderPath) {
  if (relativeFolderPath.empty()) return FolderCheckResult::unknownError;

  std::string fatFsPath(relativeFolderPath);
  std::replace(fatFsPath.begin(), fatFsPath.end(), '/', '\\');

  std::string filenames{};
  filenames.resize(8192); // Dozens of log files should not cause memory overflow

  errno = 0;
  int err = pros::usd::list_files(fatFsPath.c_str(),
                                  filenames.data(), filenames.size() - 1);
  if (err == 1) return FolderCheckResult::success;
  if (errno == ENOENT) return FolderCheckResult::notFound;
  return FolderCheckResult::unknownError;
}
} // namespace

void Logger::getTimestampedFilename(char *buffer, size_t len) {
  if (!buffer || len == 0) return;

  struct timespec tspec;
  clock_gettime(CLOCK_REALTIME, &tspec);

  std::chrono::sys_seconds currentTime{std::chrono::seconds(tspec.tv_sec)};
  const std::string formattedTime = std::format("{:%Y-%m-%d_%H-%M-%S}", currentTime);

  std::string folderBuf(m_loggingFolder);
  trimTrailingSeparator(folderBuf, '/');
  const uint32_t randInt = getrandInt(0, 99999);

  if (tspec.tv_sec < recentEpochTime) {
    _MVLIB_FORWARD_INFO("initSdCard() VEX RTC Inaccurate. Falling back to program duration.");

    snprintf(buffer, len, "%s%sMVLIB_%s_%u-%u_%03u.log",
             folderBuf.c_str(), folderBuf == "/" ? "" : "/",
             m_date, pros::millis() / 1000, pros::millis() % 1000, randInt);
  } else {
    _MVLIB_FORWARD_INFO("initSdCard() VEX RTC Plausible. Creating file name with date.");

    char timeBuf[128];
    // Format the date/time string
    snprintf(timeBuf, sizeof(timeBuf), "MVLIB_%s", formattedTime); 

    // Combine pathPrefix, formatted time, and random ID
    snprintf(buffer, len, "%s%s%s_%05d.log",
             folderBuf.c_str(), folderBuf == "/" ? "" : "/", timeBuf, randInt);
  }

  buffer[len - 1] = '\0';
}

bool Logger::initSDLogger() {
  if (m_sdLocked) return false;

  if (pros::usd::is_installed()) {
    _MVLIB_FORWARD_DEBUG("initSdCard() SD Card installed (On first attempt)");
  } else {
    _MVLIB_FORWARD_DEBUG("initSdCard() SD Card not installed, rechecking...");
    for (int i = 0; i < 10; i++) {
      if (pros::usd::is_installed()) {
        _MVLIB_FORWARD_DEBUG("initSdCard() SD Card installed! Attempt: %d/10", i);
        break;
      }
      _MVLIB_FORWARD_DEBUG("initSdCard() Rechecking SD card installment... Attempts: %d/10", i);
      pros::delay(50);
    }
  }

  if (!pros::usd::is_installed()) {
    _MVLIB_FORWARD_FATAL("initSdCard() SD Card not installed after 10 attemps. Aborting SD card.");
    return false;
  }

  if (m_currentFilename[0] == '\0') {
    // Filename not set, generate one as a full relative SD path.
    getTimestampedFilename(m_currentFilename, sizeof(m_currentFilename));
    m_currentFilename[sizeof(m_currentFilename) - 1] = '\0';
  }

  char relativePathBuf[sizeof(m_currentFilename)];
  strncpy(relativePathBuf, m_currentFilename, sizeof(relativePathBuf) - 1);
  relativePathBuf[sizeof(relativePathBuf) - 1] = '\0';

  char absolutePathBuf[133];
  if (relativePathBuf[0] == '\0') {
    _MVLIB_FORWARD_FATAL("initSdCard() Filename generation failed. Aborting.");
    return false;
  }

  snprintf(absolutePathBuf, sizeof(absolutePathBuf), "/usd%s", relativePathBuf);
  absolutePathBuf[sizeof(absolutePathBuf) - 1] = '\0';
  strncpy(m_absoluteFilename, absolutePathBuf, sizeof(m_absoluteFilename) - 1);
  m_absoluteFilename[sizeof(m_absoluteFilename) - 1] = '\0';

  m_sdFile = fopen(absolutePathBuf, "w");

  if (!m_sdFile) {
    _MVLIB_FORWARD_FATAL("initSdCard() File: %s could not be opened. Aborting.", absolutePathBuf);
    return false;
  }

  _MVLIB_FORWARD_DEBUG("initSdCard() File successfully opened.");
  fprintf(m_sdFile, "|———| Logger initialized at %.2fs |———|\n", pros::millis() / 1000.0);
  fflush(m_sdFile);
  return true;
}

bool Logger::setLoggingLocation(const char *location,
                                Logger::MissingFolderPolicy folderPolicy,
                                Logger::ExistingFilePolicy filePolicy) {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return false;
  if (m_started || m_sdLocked) return false;

  if (!location || location[0] == '\0' || location[0] != '/') {
    _MVLIB_FORWARD_INFO("setLoggingLocation() called with invalid location");
    return false;
  }

  const std::string normalizedLocation = toPosixPath(location);
  const std::string_view normalizedLocationView(normalizedLocation);
  const bool isFilename = normalizedLocationView.find('.') != std::string_view::npos;
  const bool isFolder = isLocationFolder(normalizedLocationView);
  std::string requestedDirectory = isFilename
    ? getDirectoryFromPath(normalizedLocationView)
    : normalizedLocation;
  const std::string basename = isFilename
    ? getFilenameFromPath(normalizedLocationView)
    : std::string{};

  if (!isFilename && !isFolder) {
    _MVLIB_FORWARD_INFO("setLoggingLocation() called with invalid location: %s", location);
    return false;
  }

  if (basename.find('.') == std::string::npos && isFilename) {
    _MVLIB_FORWARD_INFO("setLoggingLocation() called with filename lacking extension: %s", location);
    return false;
  }

  if (requestedDirectory.empty()) requestedDirectory = "/";
  if (requestedDirectory.find('.') != std::string::npos) {
    _MVLIB_FORWARD_INFO("setLoggingLocation() called with invalid folder segments: %s", location);
    return false;
  }

  std::string resolvedDirectory = requestedDirectory;
  FolderCheckResult folderCheck = checkFolderExists(requestedDirectory);
  if (folderCheck != FolderCheckResult::success) {
    if (folderCheck == FolderCheckResult::notFound) {
      if (folderPolicy == Logger::MissingFolderPolicy::disable) {
        _MVLIB_FORWARD_ERROR("setLoggingLocation() could not find the path specified. "
          "Path: %s", requestedDirectory.c_str());
        m_sdLocked = true;
        return false;
      }
      _MVLIB_FORWARD_WARN("setLoggingLocation() could not find the path specified. "
        "Falling back to SD root. Path: %s", requestedDirectory.c_str());
      resolvedDirectory = "/";
    } else {
      _MVLIB_FORWARD_ERROR("setLoggingLocation() failed setting errno: %d", errno);
      return false;
    }
  }

  if (isFilename) {
    const std::string resolvedFilePath = joinPath(resolvedDirectory, basename);
    const bool fileExists = doesFileExist(resolvedFilePath);

    if (fileExists) {
      switch (filePolicy) {
      case Logger::ExistingFilePolicy::disable:
        _MVLIB_FORWARD_INFO("setLoggingLocation() called with existing filename: %s", resolvedFilePath.c_str());
        m_sdLocked = true;
        return false;
      case Logger::ExistingFilePolicy::overwrite:
        _MVLIB_FORWARD_INFO("setLoggingLocation() file already exists; overwriting: %s", resolvedFilePath.c_str());
        strncpy(m_currentFilename, resolvedFilePath.c_str(), sizeof(m_currentFilename) - 1);
        m_currentFilename[sizeof(m_currentFilename) - 1] = '\0';
        break;
      case Logger::ExistingFilePolicy::automatic:
        _MVLIB_FORWARD_INFO("setLoggingLocation() file already exists; falling back to auto-generated filename in: %s",
                             resolvedDirectory.c_str());
        m_currentFilename[0] = '\0';
        break;
      }
    } else {
      strncpy(m_currentFilename, resolvedFilePath.c_str(), sizeof(m_currentFilename) - 1);
      m_currentFilename[sizeof(m_currentFilename) - 1] = '\0';
    }
  } else {
    m_currentFilename[0] = '\0';
  }

  // Trim the std::string before copying to the raw buffer
  trimTrailingSeparator(resolvedDirectory, '/');
  snprintf(m_loggingFolder, sizeof(m_loggingFolder), "%s", resolvedDirectory.c_str());

  _MVLIB_FORWARD_INFO("setLoggingLocation() successfully set logging folder to: %s", m_loggingFolder);
  if (m_currentFilename[0] != '\0') {
    _MVLIB_FORWARD_INFO("setLoggingLocation() successfully set logging file to: %s", m_currentFilename);
  }
  return true;
}

void Logger::logToSD(const LogLevel level, const char *fmt, ...) {
  if (!m_sdFile || m_sdLocked) return;

  detail::uniqueLock m(m_sdMutex);
  if (!m.isLocked()) return;
  if (!detail::Telemetry::getInstance().shouldLog(level)) return;
  if (!m_sdFile || m_sdLocked) return;

  va_list args;
  va_start(args, fmt);
  vfprintf(m_sdFile, fmt, args);
  va_end(args);

  fprintf(m_sdFile, "\n");

  bool isError = (level == LogLevel::ERROR || level == LogLevel::FATAL);

  uint32_t now = pros::millis();
  if (isError || (now - m_lastFileFlush >= m_timings.sdBufferFlushInterval)) {
    fflush(m_sdFile);
    m_lastFileFlush = now;
  }
}
} // namespace mvlib
