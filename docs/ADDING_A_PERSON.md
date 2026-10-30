# Adding a person

1. Keep the original screenshots in `sources/<id>/` (optional, for provenance).
2. Create `data/people/<id>.json`:

   ```json
   {
     "events": [
       { "date": "2026-11-05", "start": "08:00", "end": "11:40", "title": "机器学习", "location": "上院103" }
     ]
   }
   ```

   - One entry per class occurrence, with its real date (`YYYY-MM-DD`) and 24h `HH:MM` times.
   - `location` is optional. Course and room names can stay in Chinese.
   - Weekly timetables often differ, so list every dated occurrence rather than a recurrence.

3. Add a line to `data/people.json`:

   ```json
   { "id": "alice", "name": "Alice", "color": "#ef4444", "file": "people/alice.json" }
   ```

   Pick a color different from the others (white text is drawn on it).

4. Reload the page: the new person appears as a chip and is included in the common free slots.

Invalid dates/times (or `start >= end`) make the page show an error naming the offending event.
