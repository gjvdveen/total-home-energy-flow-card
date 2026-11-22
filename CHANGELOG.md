# Changelog

## 1.2.0 (unreleased)
- **Price next to the charts**: the current price now sits small at the bottom right, on the same line as *Charts*, on every view. This frees up room in the schematic. `price.position: top` keeps the old pill. Tap the price to unfold the cheapest and most expensive moment of today and tomorrow.
- **`min_power`**: set from how many watts a tile lights up and its line starts flowing (card-wide, per item, or on the battery). Default 20 W.
- Grid export colour changed to mint (`#00c7be`) so it no longer looks the same as the battery.
- **Victron layout**: tell each item where it is connected with `ac: in`, `ac: out1` or `ac: out2`. The schematic then draws the grid and AC-in devices on the left, and AC-out 1 and AC-out 2 as separate branches on the right of the inverter, each with a small label. Sources on AC-out (like a PV inverter) use `source: true`. Labels can be renamed with `labels: {ac_in, ac_out1, ac_out2}`. In this layout the battery sits above the inverter (`battery_position: top|bottom` to choose) AC-out 1 leaves the bottom of the inverter and its devices fill both columns from the bottom up (`split: false` keeps them on the right); AC-out 2 gets its own branch from the right of the inverter with its devices at the top right. The connections are shown as labelled ports on the inverter, placed so they never cover the model text or phase bars. Left and right tiles share one row grid, so they line up (a tile with phase bars spans two rows).
- **Before or after the inverter**: give a device `ac: in` when it sits on the grid side (e.g. an EV charger before a Victron inverter). It then hangs on the grid line, under the grid tile, and is not subtracted from *Other*.
- **Other without a home tile**: `rest: {name, entity}` uses its own total sensor (e.g. the whole-home consumption), so you can drop the home tile and show e.g. *Home other* next to your devices.
- **Inverter model and image**: `inverter.model` adds a line with the type, `inverter.image` shows your own small image instead of the icon.
- **Inverter phases**: `inverter.phases` shows per-phase bars (e.g. AC-out L1–L3) in the inverter tile.
- **Home branch**: in the schematic the first right tile (home) hangs on the inverter; all other consumers (plus *Other*) are shown in a grid underneath, fed from home, so it's clear they are part of the home total (up to 9). Turn off with `branch: false`.
- Middle column (price, solar, inverter, battery) is stacked from the top instead of stretched.
- **New 4th view "Today"**: the schematic with kWh since midnight for every tile (grid import with export, solar, battery charged/discharged, home, each device and *Other*). Add `energy:` (kWh meter) to items, `energy_import`/`energy_export` to the grid and `energy_charge`/`energy_discharge` to the battery. Without a home meter the home total is calculated from the energy balance. The view is titled *Total today* (unless you set `page_titles.today`) and every tile says what the number is: *produced* for sources like solar, *used* for consumers, *imported · export* for the grid.

## 1.1.0
- **New: "Other" tile** (`rest: true`) – the home total minus all listed consumers, so you see what you don't measure separately. Use `in_rest: false` on an item to leave it out of the calculation.
- **Compact layout**: with few devices the schematic shrinks (smaller battery/inverter tiles, shorter lines), and grows again when you add more.
- Up to **5 tiles per side** in the schematic; grid and home tiles are a bit more compact.
- Inverter tile: title and state centred, state text smaller (no awkward wrapping on phones).

## 1.0.0
- First release: ring, list and schematic views, per-phase power, devices, gas/water tiles, live price and charts.
