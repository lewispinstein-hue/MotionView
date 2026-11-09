#include "mvlib/private/telemetryWrite.hpp"

#include <algorithm>
#include <cassert>
#include <cstdint>
#include <vector>

int main() {
  const std::vector<uint8_t> frame{1, 2, 3, 4, 5, 6, 7, 8, 9, 0};
  std::vector<uint8_t> sent;
  int attempts = 0;
  int waits = 0;

  mvlib::detail::writeTelemetryFully(
      frame.data(), frame.size(),
      [&](const uint8_t* bytes, size_t count) -> int {
        ++attempts;
        if (attempts >= 2 && attempts <= 12) return 0;
        const size_t accepted = std::min(count, attempts == 1 ? size_t{4} : size_t{3});
        sent.insert(sent.end(), bytes, bytes + accepted);
        return static_cast<int>(accepted);
      },
      [&] { ++waits; });

  assert(waits == 11);
  assert(sent == frame);
}
