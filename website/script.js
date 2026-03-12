const shouldAnimate = !window.matchMedia("(prefers-reduced-motion: reduce)")
  .matches;

if (shouldAnimate) {
  document.documentElement.classList.add("has-motion");
}

const revealElements = document.querySelectorAll(".reveal");

if (
  revealElements.length > 0 &&
  "IntersectionObserver" in window &&
  shouldAnimate
) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    {
      threshold: 0.18,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  revealElements.forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index * 35, 260)}ms`;
    observer.observe(element);
  });
} else {
  for (const element of revealElements) {
    element.classList.add("is-visible");
  }
}
