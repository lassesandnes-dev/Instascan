"""Generate a deterministic synthetic terrain point file (stockpile next to an excavation).

Coordinates are UTM zone 32N (EPSG:25832) eastings/northings near Oslo with
NN2000 heights, so large-coordinate precision handling is exercised.

    python3 samples/generate_sample.py > samples/terrain-stockpile-epsg25832.xyz
"""
import math
import random

random.seed(42)
E0, N0, H0 = 598_100.0, 6_643_200.0, 112.0
SIZE, STEP = 60.0, 0.4

print("# Synthetic terrain sample - EPSG:25832 / NN2000 - units: metres")
print("x,y,z,r,g,b")
n = int(SIZE / STEP)
for i in range(n):
    for j in range(n):
        x = i * STEP + random.uniform(-0.05, 0.05)
        y = j * STEP + random.uniform(-0.05, 0.05)
        z = 0.02 * x + 0.01 * y  # gentle slope
        d = math.hypot(x - 18, y - 20)
        if d < 9:  # stockpile cone
            z += 4.0 * (1 - d / 9)
        if 34 < x < 52 and 30 < y < 48:  # excavation pit with 1:1 side slopes
            depth = min(2.5, x - 34, 52 - x, y - 30, 48 - y)
            z -= depth
        z += random.uniform(-0.02, 0.02)
        if d < 9:
            r, g, b = 150, 120, 85
        elif 34 < x < 52 and 30 < y < 48:
            r, g, b = 120, 100, 80
        else:
            r, g, b = 85, 130, 70
        print(f"{E0 + x:.3f},{N0 + y:.3f},{H0 + z:.3f},{r},{g},{b}")
