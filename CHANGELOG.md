# Changelog

## 1.2.0 (unreleased)
- **Before or after the inverter**: give a device `ac: in` when it sits on the grid side (e.g. an EV charger before a Victron inverter). It then hangs on the grid line, under the grid tile, and is not subtracted from *Other*.
- **Inverter phases**: `inverter.phases` shows per-phase bars (e.g. AC-out L1–L3) in the inverter tile.
- **Home branch**: in the schematic the first right tile (home) hangs on the inverter; all other consumers (plus *Other*) are shown in a grid underneath, fed from home, so it's clear they are part of the home total (up to 9). Turn off with `branch: false`.
- Middle column (price, solar, inverter, battery) is stacked from the top instead of stretched.
- **New 4th view "Today"**: the schematic with kWh since midnight for every tile (grid import with export, solar, battery charged/discharged, home, each device and *Other*). Add `energy:` (kWh meter) to items, `energy_import`/`energy_export` to the grid and `energy_charge`/`energy_discharge` to the battery. Without a home meter the home total is calculated from the energy balance.

## 1.1.0
- **New: "Other" tile** (`rest: true`) – the home total minus all listed consumers, so you see what you don't measure separately. Use `in_rest: false` on an item to leave it out of the calculation.
- **Compact layout**: with few devices the schematic shrinks (smaller battery/inverter tiles, shorter lines), and grows again when you add more.
- Up to **5 tiles per side** in the schematic; grid and home tiles are a bit more compact.
- Inverter tile: title and state centred, state text smaller (no awkward wrapping on phones).

## 1.0.0
- First release: ring, list and schematic views, per-phase power, devices, gas/water tiles, live price and charts.
