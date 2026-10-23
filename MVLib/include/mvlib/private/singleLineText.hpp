#pragma once

#include <cstddef>

namespace mvlib {
namespace detail {

// Both live telemetry and SD replay are transported as single-line records.
// Preserve commas, quotes, tabs, and UTF-8 bytes; only CR/LF split records.
inline char singleLineCharacter(char value) {
  return value == '\r' || value == '\n' ? ' ' : value;
}

inline void copySingleLineText(char* destination, const char* source,
                               std::size_t length) {
  for (std::size_t index = 0; index < length; ++index) {
    destination[index] = singleLineCharacter(source[index]);
  }
}

} // namespace detail
} // namespace mvlib
