# Nutrition

A personal app to record calories, macros, steps, and weight on an iPhone.
It runs as a Home Screen web app. All data stays on the phone.

## What the app does

- **Goals.** Calories, protein, and steps have a goal. Carbs and fat can have a goal. Each goal is a floor (minimum) or a ceiling (maximum).
- **Food.** You save foods with the values for one serving. You add them with a multiplier, for example 1.6. You can also add a one-time food.
- **Steps.** An Apple Shortcut copies the step totals for yesterday and today. One tap on "Paste steps" updates both days.
- **Weight.** You add one weight each day, in pounds.
- **Deficit or surplus.** The app estimates it for each day:
  - Base burn: the Mifflin-St Jeor formula, with the average weight of the last 7 days.
  - Plus a fixed number of calories for daily life (300 at the start).
  - Plus the step burn: steps ÷ 2,000 × weight in pounds × 0.53.
  - Minus the calories that you ate.
- **Overview.** A calendar with one square for each day, the current and longest streak, and a weight chart.
- **Export and import.** A compact CSV (one row for each day) and a full CSV (everything). The import reads the full CSV and replaces all data.

## Put the app on GitHub Pages

1. Make a public repository on GitHub and push these files to it.
2. On GitHub, open **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**. Select the main branch and the root folder. Click **Save**.
4. After a minute, GitHub shows the address of the app.

## Install the app on the iPhone

1. Open the address in **Safari**.
2. Tap the **Share** button. Then tap **Add to Home Screen**.
3. Open the app from the Home Screen icon. Use only this icon. Safari has a different storage.
4. In **Settings**, type your height, age, and sex.

**Important:** if you delete the Home Screen icon, iOS also deletes the data. Export a full CSV regularly.

## Publish a new version

1. Change the files.
2. In `sw.js`, change `VERSION` to a new value, for example `v2`. If you do not change it, the iPhone keeps the old files.
3. Push the change to GitHub.
4. Open the app on the iPhone. It gets the new version, then it reloads one time.

## Test on the PC

1. In this folder, run `python -m http.server 8000`.
2. Open `http://localhost:8000` in a browser. On this address, the offline copy is off, so each change shows at once.
3. Open `http://localhost:8000/tests/logic-test.html` to run the tests for the calculations and the CSV files.
