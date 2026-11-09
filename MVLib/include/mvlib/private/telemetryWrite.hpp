#pragma once

#include <cstddef>
#include <cstdint>

namespace mvlib {
namespace detail {

// A partial serial write has already put the beginning of a COBS frame on the
// wire. Finish that frame before sending the next one, even under backpressure.
// The caller runs this only on the low-priority telemetry IO task.
template <typename WriteFn, typename WaitFn>
void writeTelemetryFully(const uint8_t* data, size_t len,
                         WriteFn&& writeFn, WaitFn&& waitFn) {
  size_t written = 0;
  while (written < len) {
    const auto result = writeFn(data + written, len - written);
    if (result > 0) {
      written += static_cast<size_t>(result);
    } else {
      waitFn();
    }
  }
}

} // namespace detail
} // namespace mvlib
