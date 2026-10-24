const stars = Array.from({ length: 90 }, (_, index) => ({
  x: ((index * 173 + 29) % 1193) + 3,
  y: ((index * 137 + 53) % 887) + 3,
  radius: index % 9 === 0 ? 1.7 : index % 3 === 0 ? 1 : 0.6,
}));

/** Deterministic, decorative SVG/CSS motion: no timers, network assets or hydration randomness. */
export function CosmicScene() {
  return (
    <div className="cosmic-scene" aria-hidden="true">
      <div className="cosmic-nebula cosmic-nebula-blue" />
      <div className="cosmic-nebula cosmic-nebula-violet" />
      <svg
        className="cosmic-stars"
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id="cosmic-trail">
            <stop stopColor="#b8d9ff" stopOpacity="0" />
            <stop offset="1" stopColor="#e8f2ff" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((layer) => (
          <g
            key={layer}
            className={`cosmic-star-layer cosmic-star-layer-${layer}`}
          >
            {stars
              .filter((_, index) => index % 3 === layer)
              .map((star, index) => (
                <circle
                  key={index}
                  cx={star.x}
                  cy={star.y}
                  r={star.radius}
                  fill={index % 4 ? "#dce8ff" : "#b4b9ff"}
                />
              ))}
          </g>
        ))}
        <g className="cosmic-constellation" stroke="#a6bcff" strokeWidth="0.6">
          <path d="M80 205 180 110 260 165 375 80M180 110 205 280 80 205M830 670 920 600 1020 690 1120 560" />
          {[
            [80, 205],
            [180, 110],
            [260, 165],
            [375, 80],
            [205, 280],
            [830, 670],
            [920, 600],
            [1020, 690],
            [1120, 560],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="#cedaff" />
          ))}
        </g>
        <g className="cosmic-meteor cosmic-meteor-one">
          <path
            d="m0 0 125 -68"
            stroke="url(#cosmic-trail)"
            strokeWidth="1.4"
          />
          <circle cx="125" cy="-68" r="1.7" fill="#fff" />
        </g>
        <g className="cosmic-meteor cosmic-meteor-two">
          <path d="m0 0 90 -49" stroke="url(#cosmic-trail)" />
          <circle cx="90" cy="-49" r="1.3" fill="#fff" />
        </g>
      </svg>
      <div className="cosmic-system">
        <div className="cosmic-halo" />
        <div className="cosmic-orbit cosmic-orbit-outer">
          <span />
        </div>
        <div className="cosmic-orbit cosmic-orbit-inner">
          <span />
        </div>
        <div className="cosmic-planet" />
        <div className="cosmic-ring" />
        <div className="cosmic-starburst" />
      </div>
      <div className="cosmic-vignette" />
    </div>
  );
}
