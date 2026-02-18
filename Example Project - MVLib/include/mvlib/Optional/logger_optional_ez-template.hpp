#pragma once

#ifdef _MVLIB_OPTIONAL_USED
#error "More than one type of Logger/Optional include used!"
#endif

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED
#include "mvlib/core.hpp" // IWYU pragma: keep
#include "EZ-Template/api.hpp"  // IWYU pragma: keep

#include <optional>

namespace mvlib {
inline void setOdom(Logger& logger, ez::Drive* chassis) {
  logger.setPoseGetter([chassis]() -> std::optional<Pose> {
    if (!chassis || !chassis->odom_enabled()) return std::nullopt;

    const float xIn   = chassis->odom_x_get();       // inches :contentReference[oaicite:1]{index=1}
    const float yIn   = chassis->odom_y_get();       // inches :contentReference[oaicite:2]{index=2}
    const float thDeg = chassis->odom_theta_get();   // degrees :contentReference[oaicite:3]{index=3}

    return Pose{xIn, yIn, thDeg};
  });
}
} // namespace mvlib
#endif
