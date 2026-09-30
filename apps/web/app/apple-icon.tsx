import { ImageResponse } from "next/og";
import { BrandMark } from "../components/BrandMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the mark edge to edge, since iOS rounds the corners itself. */
export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} rounded={false} />, size);
}
