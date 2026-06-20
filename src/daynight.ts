// Day/night cycle: a slow clock drives sky colour, fog colour, sun/ambient
// light intensity, and a terrain light multiplier so mined-out caves and
// night-time actually get darker, not just the sky.

import * as THREE from 'three';

/** Seconds for one full day/night cycle. */
export const DAY_LENGTH = 240;

const SKY_DAY = new THREE.Color(0x8fc6ff);
const SKY_NIGHT = new THREE.Color(0x040714);
const SKY_TWILIGHT = new THREE.Color(0xff8a4c);

export interface DayNightState {
  dayFactor: number; // 0 = full night, 1 = full day
  sunIntensity: number;
  ambientIntensity: number;
  lightLevel: number; // terrain colour multiplier
  isNight: boolean;
}

const tmpSky = new THREE.Color();

/** Compute lighting state for a given elapsed time (seconds), and write the sky colour into `out`. */
export function computeDayNight(time: number, out: THREE.Color): DayNightState {
  const t = ((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH / DAY_LENGTH; // [0,1)
  const sunHeight = Math.sin(2 * Math.PI * (t - 0.25)); // -1..1, peaks at noon
  const dayFactor = Math.max(0, Math.min(1, sunHeight * 1.3 + 0.3));

  out.copy(SKY_NIGHT).lerp(SKY_DAY, dayFactor);
  // Warm twilight tint near sunrise/sunset (sun close to the horizon).
  const twilight = Math.max(0, 1 - Math.abs(sunHeight) / 0.35);
  if (twilight > 0) out.lerp(tmpSky.copy(SKY_TWILIGHT), twilight * 0.5);

  return {
    dayFactor,
    sunIntensity: 0.15 + 0.85 * dayFactor,
    ambientIntensity: 0.25 + 0.5 * dayFactor,
    lightLevel: 0.35 + 0.65 * dayFactor,
    isNight: dayFactor < 0.35,
  };
}
