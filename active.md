# Repository Lock & Status

**Status:** NOT WORKING
**Last Updated:** 2026-11-04 10:30 IST
**Details:** Fixed Google Calendar timezone offset conversion: natural time parsing now calculates and formats RFC3339 timestamps using the client's local timezone offset (e.g. +05:30 for Asia/Kolkata) instead of UTC, eliminating the 5h30m drift. All 83 tests passing.
