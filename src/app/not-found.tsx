import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty" style={{ marginTop: 40 }}>
      <p className="eyebrow">404</p>
      <h1>This page doesn&apos;t exist</h1>
      <p className="caption">The run or question may not be published on this deployment.</p>
      <Link href="/runs" className="btn">
        Browse runs
      </Link>
    </div>
  );
}
