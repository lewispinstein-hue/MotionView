#include "mvlib/private/sdSink.hpp"
#include "mvlib/private/raii.hpp"
#include "pros/misc.hpp"
#include "pros/rtos.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <format>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <time.h>

namespace mvlib {
namespace detail {

uint32_t SdSink::getRandomInt(uint32_t min, uint32_t max) {
  uint64_t seed = pros::micros();
  seed ^= static_cast<uint64_t>(pros::battery::get_voltage()) << 32;
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

bool SdSink::isLocationFolder(const std::string_view absolutePath, char separator) {
  if (absolutePath.empty()) return false;
  const bool containsNoFilenames = absolutePath.find('.') == std::string_view::npos;
  const size_t slashCount = static_cast<size_t>(std::count(absolutePath.begin(),
                                                           absolutePath.end(),
                                                           separator));
  return containsNoFilenames && slashCount > 0;
}

void SdSink::trimTrailingSeparator(std::string& path, char separator) {
  while (path.size() > 1 && path.back() == separator) {
    path.pop_back();
  }
}

std::string SdSink::toPosixPath(const std::string_view path) {
  std::string normalized(path);
  std::replace(normalized.begin(), normalized.end(), '\\', '/');
  return normalized;
}

std::string SdSink::getFilenameFromPath(const std::string_view path, char separator) {
  if (path.empty()) return {};
  const size_t lastSlash = path.find_last_of(separator);
  if (lastSlash == std::string_view::npos) return std::string(path);
  return std::string(path.substr(lastSlash + 1));
}

std::string SdSink::getDirectoryFromPath(const std::string_view path, char separator) {
  if (path.empty()) return {};
  if (path.back() == separator) return std::string(path);

  const size_t lastSlash = path.find_last_of(separator);
  if (lastSlash == std::string_view::npos) return {};
  if (lastSlash == 0) return std::string(1, separator);
  return std::string(path.substr(0, lastSlash));
}

std::string SdSink::joinPath(const std::string_view folder, const std::string_view basename) {
  if (basename.empty()) return std::string(folder);
  if (folder.empty() || folder == "/") return std::string("/") + std::string(basename);
  std::string path(folder);
  path += "/";
  path += basename;
  return path;
}

bool SdSink::doesFileExist(const std::string_view relativePath) {
  if (relativePath.empty()) return false;
  if (FILE* file = fopen( ("/usd" + std::string(relativePath)).c_str(), "r")) {
    fclose(file);
    return true;
  }
  return false;
}

SdSink::FolderCheckResult SdSink::checkFolderExists(
    const std::string_view relativeFolderPath) {
  if (relativeFolderPath.empty()) return FolderCheckResult::unknownError;

  std::string fatFsPath(relativeFolderPath);
  std::replace(fatFsPath.begin(), fatFsPath.end(), '/', '\\');

  std::string filenames(8192, '\0');
  errno = 0;
  const int err = pros::usd::list_files(fatFsPath.c_str(), filenames.data(),
                                        filenames.size() - 1);
  if (err == 1) return FolderCheckResult::success;
  if (errno == ENOENT) return FolderCheckResult::notFound;
  return FolderCheckResult::unknownError;
}

std::optional<std::chrono::sys_days> SdSink::parseBuildDate(
    const std::string_view buildDate) {
  if (buildDate.size() != 11) return std::nullopt;

  constexpr std::string_view months[] = {
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  };

  unsigned month = 0;
  const std::string_view monthName = buildDate.substr(0, 3);
  for (unsigned i = 0; i < sizeof(months) / sizeof(months[0]); ++i) {
    if (months[i] == monthName) {
      month = i + 1;
      break;
    }
  }
  if (month == 0) return std::nullopt;

  const auto parseDigit = [](char ch) -> int {
    return (ch >= '0' && ch <= '9') ? ch - '0' : -1;
  };

  const int dayTens = buildDate[4] == ' ' ? 0 : parseDigit(buildDate[4]);
  const int dayOnes = parseDigit(buildDate[5]);
  const int y0 = parseDigit(buildDate[7]);
  const int y1 = parseDigit(buildDate[8]);
  const int y2 = parseDigit(buildDate[9]);
  const int y3 = parseDigit(buildDate[10]);
  if (dayTens < 0 || dayOnes < 0 || y0 < 0 || y1 < 0 || y2 < 0 || y3 < 0) {
    return std::nullopt;
  }

  const unsigned day = static_cast<unsigned>(dayTens * 10 + dayOnes);
  const int year = y0 * 1000 + y1 * 100 + y2 * 10 + y3;
  const std::chrono::year_month_day ymd{
    std::chrono::year{year}, std::chrono::month{month}, std::chrono::day{day}};
  if (!ymd.ok()) return std::nullopt;
  return std::chrono::sys_days{ymd};
}

bool SdSink::isRtcWithinBuildWindow(time_t rtcSeconds,
                                    const std::string_view buildDate) {
  if (rtcSeconds <= 0) return false;

  const auto buildDay = parseBuildDate(buildDate);
  if (!buildDay.has_value()) return false;

  const std::chrono::sys_seconds rtcTime{std::chrono::seconds{rtcSeconds}};
  const std::chrono::sys_days rtcDay = std::chrono::floor<std::chrono::days>(rtcTime);
  const std::chrono::year_month_day maxDate{
    std::chrono::year_month_day{*buildDay} + std::chrono::years{5}};
  if (!maxDate.ok()) return false;

  return rtcDay >= *buildDay && rtcDay <= std::chrono::sys_days{maxDate};
}

SdSink::~SdSink() {
  uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked()) return;

  if (m_file) {
    fflush(m_file);
    fclose(m_file);
    m_file = nullptr;
  }
}

SdLocationResult SdSink::setLocation(const char* location,
                                     MissingFolderPolicy folderPolicy,
                                     ExistingFilePolicy filePolicy) {
  SdLocationResult result;
  uniqueLock lock(m_mutex);
  if (!lock.isLocked() || m_locked) {
    result.locked = m_locked;
    return result;
  }

  if (!location || location[0] == '\0' || location[0] != '/') {
    result.error = SdLocationError::invalidLocation;
    return result;
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
    result.error = SdLocationError::invalidLocationSyntax;
    return result;
  }

  const size_t extensionSeparator = basename.find_last_of('.');
  if (isFilename && (extensionSeparator == std::string::npos ||
                     extensionSeparator == 0 ||
                     extensionSeparator + 1 == basename.size())) {
    result.error = SdLocationError::missingFilenameExtension;
    return result;
  }

  if (requestedDirectory.empty()) requestedDirectory = "/";
  snprintf(result.requestedDirectory, sizeof(result.requestedDirectory), "%s",
           requestedDirectory.c_str());
  if (requestedDirectory.find('.') != std::string::npos) {
    result.error = SdLocationError::invalidFolderSegments;
    return result;
  }

  std::string resolvedDirectory = requestedDirectory;
  const FolderCheckResult folderCheck = checkFolderExists(requestedDirectory);
  if (folderCheck != FolderCheckResult::success) {
    if (folderCheck == FolderCheckResult::notFound) {
      if (folderPolicy == MissingFolderPolicy::disable) {
        m_locked = true;
        result.locked = true;
        result.error = SdLocationError::missingFolder;
        return result;
      }
      result.usedRootFallback = true;
      resolvedDirectory = "/";
    } else {
      result.error = SdLocationError::folderLookup;
      result.errorNumber = errno;
      return result;
    }
  }

  trimTrailingSeparator(resolvedDirectory, '/');
  if (resolvedDirectory.size() >= sizeof(m_folder)) {
    result.error = SdLocationError::pathTooLong;
    return result;
  }

  if (isFilename) {
    const std::string resolvedFilePath = joinPath(resolvedDirectory, basename);
    if (resolvedFilePath.size() >= sizeof(m_filename)) {
      result.error = SdLocationError::pathTooLong;
      return result;
    }
    snprintf(result.resolvedFilePath, sizeof(result.resolvedFilePath), "%s",
             resolvedFilePath.c_str());
    if (doesFileExist(resolvedFilePath)) {
      switch (filePolicy) {
      case ExistingFilePolicy::disable:
        m_locked = true;
        result.locked = true;
        result.error = SdLocationError::existingFile;
        return result;
      case ExistingFilePolicy::overwrite:
        result.overwroteExistingFile = true;
        snprintf(m_filename, sizeof(m_filename), "%s", resolvedFilePath.c_str());
        break;
      case ExistingFilePolicy::automatic:
        result.generatedNameForExistingFile = true;
        m_filename[0] = '\0';
        break;
      }
    } else {
      snprintf(m_filename, sizeof(m_filename), "%s", resolvedFilePath.c_str());
    }
  } else {
    m_filename[0] = '\0';
  }

  snprintf(m_folder, sizeof(m_folder), "%s", resolvedDirectory.c_str());
  result.accepted = true;
  return result;
}

void SdSink::getTimestampedFilename(char* buffer, size_t len,
                                    const char* buildDate, SdInitResult& result) {
  if (!buffer || len == 0 || !buildDate) return;

  struct timespec tspec;
  clock_gettime(CLOCK_REALTIME, &tspec);

  const std::chrono::sys_seconds currentTime{std::chrono::seconds(tspec.tv_sec)};
  const std::string formattedTime = std::format("{:%Y-%m-%d_%H-%M-%S}", currentTime);
  snprintf(result.formattedTime, sizeof(result.formattedTime), "%s", formattedTime.c_str());
  result.rtcPlausible = isRtcWithinBuildWindow(tspec.tv_sec, buildDate);

  std::string folder(m_folder);
  trimTrailingSeparator(folder, '/');
  const uint32_t randomId = getRandomInt(0, 99999);

  if (!result.rtcPlausible) {
    snprintf(buffer, len, "%s%sMVLIB_%s_%03u.log", folder.c_str(),
             folder == "/" ? "" : "/", buildDate, randomId);
  } else {
    snprintf(buffer, len, "%s%sMVLIB_%s_%05u.log", folder.c_str(),
             folder == "/" ? "" : "/", formattedTime.c_str(), randomId);
  }
  buffer[len - 1] = '\0';
}

SdInitResult SdSink::init(const char* buildDate, bool userBuildDateProvided) {
  SdInitResult result;
  uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked()) {
    result.error = SdInitError::locked;
    return result;
  }

  if (m_locked) {
    result.error = SdInitError::locked;
    return result;
  }

  result.cardInstalledInitially = pros::usd::is_installed();
  if (!result.cardInstalledInitially) {
    for (int attempt = 0; attempt < 10; ++attempt) {
      if (pros::usd::is_installed()) {
        result.cardDetectedAttempt = attempt;
        break;
      }
      pros::delay(50);
    }
  }

  if (!pros::usd::is_installed()) {
    result.error = SdInitError::cardMissing;
    return result;
  }

  if (m_filename[0] == '\0') {
    result.usedFallbackBuildDate = !userBuildDateProvided;
    constexpr uint32_t maxFilenameAttempts = 16;
    for (uint32_t attempt = 0; attempt < maxFilenameAttempts; ++attempt) {
      char candidate[sizeof(m_filename)] = "";
      getTimestampedFilename(candidate, sizeof(candidate), buildDate, result);
      if (candidate[0] == '\0') {
        result.error = SdInitError::filenameGeneration;
        return result;
      }
      if (!doesFileExist(candidate)) {
        snprintf(m_filename, sizeof(m_filename), "%s", candidate);
        break;
      }
    }

    if (m_filename[0] == '\0') {
      result.error = SdInitError::filenameCollision;
      return result;
    }
  }

  if (m_filename[0] == '\0') {
    result.error = SdInitError::filenameGeneration;
    return result;
  }

  snprintf(m_absoluteFilename, sizeof(m_absoluteFilename), "/usd%s", m_filename);
  m_file = fopen(m_absoluteFilename, "w");
  if (!m_file) {
    result.error = SdInitError::fileOpen;
    result.errorNumber = errno;
    return result;
  }

  const int headerResult = fprintf(
    m_file, "|———| Logger initialized at %.2fs |———|\n", pros::millis() / 1000.0);
  if (headerResult < 0 || fflush(m_file) != 0) {
    result.error = SdInitError::initialWrite;
    result.errorNumber = errno;
    fclose(m_file);
    m_file = nullptr;
  }
  return result;
}

SdWriteResult SdSink::writeV(LogLevel level, const char* format, va_list args) {
  SdWriteResult result;
  uniqueLock lock(m_mutex);
  if (!lock.isLocked()) {
    result.error = SdWriteError::busy;
    return result;
  }
  if (!m_file || m_locked) {
    result.error = SdWriteError::unavailable;
    return result;
  }

  const int writeResult = vfprintf(m_file, format, args);
  if (writeResult < 0) {
    result.error = SdWriteError::write;
    result.errorNumber = errno;
    return result;
  }

  if (fprintf(m_file, "\n") < 0) {
    result.error = SdWriteError::write;
    result.errorNumber = errno;
    return result;
  }

  const uint32_t now = pros::millis();
  const bool forceFlush = level == LogLevel::ERROR || level == LogLevel::FATAL;
  if (forceFlush || now - m_lastFlushMs >= m_flushIntervalMs.load()) {
    if (fflush(m_file) != 0) {
      result.error = SdWriteError::flush;
      result.errorNumber = errno;
      return result;
    }
    m_lastFlushMs = now;
  }
  return result;
}

SdWriteResult SdSink::write(LogLevel level, const char* format, ...) {
  va_list args;
  va_start(args, format);
  const SdWriteResult result = writeV(level, format, args);
  va_end(args);
  return result;
}

void SdSink::setFlushInterval(uint32_t flushIntervalMs) {
  m_flushIntervalMs.store(flushIntervalMs);
}

bool SdSink::ready() const {
  uniqueLock lock(m_mutex);
  return lock.isLocked() && m_file && !m_locked;
}

bool SdSink::locked() const {
  uniqueLock lock(m_mutex);
  return lock.isLocked() && m_locked;
}

bool SdSink::lock() {
  uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked() || m_locked) return false;
  m_locked = true;
  return true;
}

const char* SdSink::filename() const {
  return m_filename;
}

const char* SdSink::absoluteFilename() const {
  return m_absoluteFilename;
}

const char* SdSink::folder() const {
  return m_folder;
}

} // namespace detail
} // namespace mvlib
