// Loads the people manifest and each person's timetable.

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

function validate(person) {
  for (const e of person.events) {
    if (!DATE.test(e.date) || !TIME.test(e.start) || !TIME.test(e.end) || e.start >= e.end) {
      throw new Error(`Invalid event in ${person.id}: ${JSON.stringify(e)}`);
    }
  }
}

export async function loadPeople() {
  const manifest = await getJson('data/people.json');
  return Promise.all(
    manifest.map(async ({ id, name, color, file }) => {
      const person = await getJson(`data/${file}`);
      person.events ??= [];
      person.id = id;
      person.name = name;
      person.color = color;
      validate(person);
      return person;
    })
  );
}
