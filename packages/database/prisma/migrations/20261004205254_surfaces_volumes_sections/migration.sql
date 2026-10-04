-- AlterTable
ALTER TABLE "CrossSection" ADD COLUMN     "crs" TEXT,
ADD COLUMN     "interval" DOUBLE PRECISION,
ADD COLUMN     "length" DOUBLE PRECISION,
ADD COLUMN     "referenceSurfaceId" TEXT,
ADD COLUMN     "units" TEXT NOT NULL DEFAULT 'm';

-- AlterTable
ALTER TABLE "Surface" ADD COLUMN     "aggregation" TEXT,
ADD COLUMN     "cols" INTEGER,
ADD COLUMN     "filledCells" INTEGER,
ADD COLUMN     "originX" DOUBLE PRECISION,
ADD COLUMN     "originY" DOUBLE PRECISION,
ADD COLUMN     "rows" INTEGER,
ADD COLUMN     "validCells" INTEGER,
ADD COLUMN     "zMax" DOUBLE PRECISION,
ADD COLUMN     "zMin" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "VolumeCalculation" ADD COLUMN     "area" DOUBLE PRECISION,
ADD COLUMN     "crs" TEXT,
ADD COLUMN     "units" TEXT NOT NULL DEFAULT 'm';
