const navToggle = document.querySelector(".nav-toggle");
const body = document.body;
const shouldAnimate = !window.matchMedia("(prefers-reduced-motion: reduce)")
  .matches;

if (shouldAnimate) {
  document.documentElement.classList.add("has-motion");
}

if (navToggle instanceof HTMLButtonElement) {
  navToggle.addEventListener("click", () => {
    const expanded = navToggle.getAttribute("aria-expanded") === "true";
    navToggle.setAttribute("aria-expanded", String(!expanded));
    body.classList.toggle("nav-open", !expanded);
  });

  for (const link of document.querySelectorAll(".primary-nav a")) {
    link.addEventListener("click", () => {
      navToggle.setAttribute("aria-expanded", "false");
      body.classList.remove("nav-open");
    });
  }
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
