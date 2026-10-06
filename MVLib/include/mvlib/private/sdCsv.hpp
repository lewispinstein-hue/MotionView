#pragma once
/**
 * @file sdCsv.hpp
 * @brief Internal helpers for writing free-text fields into SD CSV records.
 */
#include <string>

namespace mvlib {
namespace detail {

// SD replay is parsed with the same comma/quote rules as RFC 4180, but the
// file is first split into lines on \r\n before any quote-aware parsing
// happens, so an embedded line break can never survive quoting -- replace it
// instead of trying to preserve it.
inline std::string escapeSdCsvField(const std::string& field) {
  std::string sanitized;
  sanitized.reserve(field.size());
  for (char c : field) sanitized += (c == '\r' || c == '\n') ? ' ' : c;

  if (sanitized.find_first_of(",\"") == std::string::npos) return sanitized;

  std::string escaped = "\"";
  escaped.reserve(sanitized.size() + 2);
  for (char c : sanitized) {
    if (c == '"') escaped += "\"\"";
    else escaped += c;
  }
  escaped += '"';
  return escaped;
}

// Log messages aren't quote-parsed on the frontend (a comma in one already
// round-trips fine), so only the line break needs to be neutralized to keep
// the record on one line.
inline void stripSdLineBreaks(char* text) {
  for (char* p = text; *p; ++p) {
    if (*p == '\r' || *p == '\n') *p = ' ';
  }
}

} // namespace detail
} // namespace mvlib
