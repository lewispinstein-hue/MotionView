#pragma once

#ifdef _MVLIB_OPTIONAL_USED
#error "More than one type of Logger/Optional include used!"
#endif

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED
#include "mvlib/core.hpp" // IWYU pragma: keep
/* 
 * Depending on your version of LemLib, this include might be outdated.
 * If lemlib/api.hpp is not found, it is likely this instead:
 * lemlib/lemlib.hpp
*/
#include "lemlib/api.hpp"  // IWYU pragma: keep
namespace mvlib {
inline void setOdom(Logger &logger, lemlib::Chassis* chassis) {
  logger.setPoseGetter([chassis]() -> std::optional<Pose> {
    if (!chassis) return std::nullopt;
    auto p = chassis->getPose();
    return Pose{p.x, p.y, p.theta};
  });
}
} // namespace mvlib
#endif
