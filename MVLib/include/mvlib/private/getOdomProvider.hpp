#pragma once
/**
 * @file getOdomProvider.hpp
 * @brief Internal MVLib helper for telemetry data
*/

#include <cstdint>

namespace mvlib {
namespace detail {
enum class OdomProvider : uint8_t {
  none, /// No getter has been set for the logger
  unknown, /// A getter has been set for the logger, but the provider is unknown
  custom, /// Provider is custom but unknown
  lemlib, /// Provider is LemLib
  ezTemplate, /// Provider is EZ-Template
  okApi /// Provider is OkapiLib
};
} // namespace detail
} // namespace mvlib
