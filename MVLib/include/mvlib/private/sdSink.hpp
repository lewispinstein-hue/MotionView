#pragma once

/**
 * @file sdSink.hpp
 * @brief Internal SD card logging sink.
 */

#include "mvlib/types.hpp"
#include "pros/rtos.hpp"

#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <time.h>

namespace mvlib {
namespace detail {

/** @brief Failure encountered while configuring an SD destination. */
enum class SdLocationError : uint8_t {
  none,
  invalidLocation,
  invalidLocationSyntax,
  missingFilenameExtension,
  invalidFolderSegments,
  pathTooLong,
  missingFolder,
  folderLookup,
  existingFile
};

/** @brief Outcome of configuring an SD logging destination. */
struct SdLocationResult {
  bool accepted = false;
  bool locked = false;
  bool usedRootFallback = false;
  bool overwroteExistingFile = false;
  bool generatedNameForExistingFile = false;
  SdLocationError error = SdLocationError::none;
  int errorNumber = 0;
  char requestedDirectory[128] = "";
  char resolvedFilePath[128] = "";
};

/** @brief Failure encountered while initializing the SD sink. */
enum class SdInitError : uint8_t {
  none,
  locked,
  cardMissing,
  filenameGeneration,
  filenameCollision,
  initialWrite,
  fileOpen
};

/** @brief Outcome of opening the SD log file. */
struct SdInitResult {
  SdInitError error = SdInitError::none;
  bool cardInstalledInitially = false;
  int cardDetectedAttempt = -1;
  bool usedFallbackBuildDate = false;
  bool rtcPlausible = false;
  int errorNumber = 0;
  char formattedTime[20] = "";

  /// @brief Return whether initialization opened a writable file.
  bool succeeded() const { return error == SdInitError::none; }
};

/** @brief Failure encountered while writing an SD log record. */
enum class SdWriteError : uint8_t {
  none,
  unavailable,
  busy,
  write,
  flush
};

/** @brief Outcome of writing one SD log record. */
struct SdWriteResult {
  SdWriteError error = SdWriteError::none;
  int errorNumber = 0;

  /// @brief Return whether the record was written and flushed when required.
  bool succeeded() const { return error == SdWriteError::none; }
};

/**
 * @class SdSink
 * @brief Owns SD log-file configuration, lifetime, and serialized writes.
 */
class SdSink {
public:
  /// @brief Create an unconfigured SD logging sink.
  SdSink() = default;

  /// @brief Flush and close an open SD log file.
  ~SdSink();

  SdSink(const SdSink&) = delete;
  SdSink& operator=(const SdSink&) = delete;

  /**
   * @brief Validate and store an SD folder or file destination.
   * @return Details of the resolved destination or failure.
   */
  SdLocationResult setLocation(const char* location, MissingFolderPolicy folderPolicy,
                               ExistingFilePolicy filePolicy);

  /**
   * @brief Wait for the SD card, generate a filename if needed, and open the log.
   * @return Details of the initialization attempt.
   */
  SdInitResult init(const char* buildDate, bool userBuildDateProvided);

  /**
   * @brief Write one formatted record and apply the configured flush policy.
   * @return Details of the write and any required flush.
   */
  SdWriteResult writeV(LogLevel level, const char* format, va_list args);

  /**
   * @brief Write one formatted record and apply the configured flush policy.
   * @return Details of the write and any required flush.
   */
  SdWriteResult write(LogLevel level, const char* format, ...);

  /// @brief Set the interval used for periodic SD buffer flushes.
  void setFlushInterval(uint32_t flushIntervalMs);

  /// @brief Return whether the sink currently has an open writable file.
  bool ready() const;

  /// @brief Return whether further SD configuration and output are disabled.
  bool locked() const;

  /**
   * @brief Permanently disable this sink for the current logger lifetime.
   * @return True only when this call changed the sink from enabled to disabled.
   */
  bool lock();

  /// @brief Return the selected SD-relative filename.
  const char* filename() const;

  /// @brief Return the selected absolute filename.
  const char* absoluteFilename() const;

  /// @brief Return the selected SD-relative folder.
  const char* folder() const;

private:
  /// @brief Result of probing an SD folder.
  enum class FolderCheckResult : uint8_t {
    success,
    notFound,
    unknownError
  };

  /// @brief Produce a non-deterministic numeric suffix.
  static uint32_t getRandomInt(uint32_t min, uint32_t max);

  /// @brief Return whether a path represents a folder.
  static bool isLocationFolder(std::string_view path, char separator = '/');

  /// @brief Remove redundant trailing path separators.
  static void trimTrailingSeparator(std::string& path, char separator = '/');

  /// @brief Convert path separators to POSIX form.
  static std::string toPosixPath(std::string_view path);

  /// @brief Return the filename portion of a path.
  static std::string getFilenameFromPath(std::string_view path, char separator = '/');

  /// @brief Return the folder portion of a path.
  static std::string getDirectoryFromPath(std::string_view path, char separator = '/');

  /// @brief Join an SD folder and filename.
  static std::string joinPath(std::string_view folder, std::string_view basename);

  /// @brief Return whether an SD-relative file exists.
  static bool doesFileExist(std::string_view relativePath);

  /// @brief Probe the requested SD folder.
  static FolderCheckResult checkFolderExists(std::string_view relativeFolderPath);

  /// @brief Parse a compiler-format build date.
  static std::optional<std::chrono::sys_days> parseBuildDate(std::string_view buildDate);

  /// @brief Return whether the RTC date is plausible for this build.
  static bool isRtcWithinBuildWindow(time_t rtcSeconds, std::string_view buildDate);

  /// @brief Generate a timestamped SD-relative filename.
  void getTimestampedFilename(char* buffer, size_t len, const char* buildDate,
                              SdInitResult& result);

  /// SD lifecycle and write serialization mutex.
  mutable pros::Mutex m_mutex;
  /// Open SD log file handle.
  FILE* m_file = nullptr;
  /// Timestamp of the most recent flush.
  uint32_t m_lastFlushMs = 0;
  /// Periodic flush interval in milliseconds.
  std::atomic<uint32_t> m_flushIntervalMs{1000};
  /// Selected SD-relative filename.
  char m_filename[128] = "";
  /// Selected absolute filename.
  char m_absoluteFilename[133] = "";
  /// Selected SD-relative folder.
  char m_folder[24] = "";
  /// Whether this sink has been permanently disabled.
  bool m_locked = false;
};

} // namespace detail
} // namespace mvlib
