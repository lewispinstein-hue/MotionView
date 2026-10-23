// Host-only fixture: exercise the actual packet producers without scheduling
// PROS tasks or opening hardware. Python decodes the resulting binary frames.
#include "../../src/mvlib/sinks/terminalOut.cpp"
#include "mvlib/private/sdCsv.hpp"
#include <cassert>

namespace pros {
inline namespace rtos {
bool Mutex::take() { return true; }
bool Mutex::take(std::uint32_t) { return true; }
bool Mutex::give() { return true; }
Mutex::~Mutex() = default;
Task::Task(task_fn_t, void*, std::uint32_t, std::uint16_t, const char*) {}
std::uint32_t Task::notify() { return 0; }
std::uint32_t Task::notify_take(bool, std::uint32_t) { return 0; }
} // namespace rtos
namespace c {
std::uint32_t millis() { return 10; }
void delay(std::uint32_t) {}
} // namespace c
} // namespace pros

int main() {
  auto& telemetry = mvlib::detail::Telemetry::getInstance();
  telemetry.sendRoster(7, "State,\r\n\"π\"");
  telemetry.sendWatchText(7, mvlib::LogLevel::INFO,
                          "first\rsecond\nthird\r\nfourth,\t\"π\"", false);
  telemetry.sendWatchText(7, mvlib::LogLevel::WARN, "", true);
  telemetry.sendLog(mvlib::LogLevel::INFO, mvlib::detail::LogSource::USER,
                    "first\rsecond\nthird\r\nfourth,\t\"π\"");

  // Sanitize at packet boundaries as well as in ordinary short text.
  telemetry.sendRoster(8, std::string(22, 'A') + "\rdiscarded");
  telemetry.sendWatchText(8, mvlib::LogLevel::INFO,
                          std::string(510, 'x') + "\ndiscarded\r\n", false);
  telemetry.sendLog(mvlib::LogLevel::INFO, mvlib::detail::LogSource::SYSTEM,
                    "%s", (std::string(510, 'x') + "\ndiscarded\r\n").c_str());

  // SD fields and live packet text share the same CR/LF policy.
  assert(mvlib::detail::escapeSdCsvField("one\r\ntwo,\"π\"") ==
         "\"one  two,\"\"π\"\"\"");
  char log[] = "one\rtwo\nthree";
  mvlib::detail::stripSdLineBreaks(log);
  assert(std::string(log) == "one two three");

  mvlib::detail::TelemetryFrame frame;
  while (mvlib::detail::dequeueTelemetryFrame(frame)) {
    if (std::fwrite(frame.bytes.data(), 1, frame.len, stdout) != frame.len) {
      return 1;
    }
  }
  return std::fflush(stdout) == 0 ? 0 : 1;
}
