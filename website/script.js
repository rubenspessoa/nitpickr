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

const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.getElementById("site-nav");
const mobileNavBreakpoint = window.matchMedia("(max-width: 720px)");

if (siteHeader && navToggle && siteNav) {
  const navLinks = siteNav.querySelectorAll("a");

  const closeMenu = ({ returnFocus = false } = {}) => {
    siteHeader.dataset.navOpen = "false";
    navToggle.setAttribute("aria-expanded", "false");

    if (returnFocus) {
      navToggle.focus();
    }
  };

  const openMenu = () => {
    siteHeader.dataset.navOpen = "true";
    navToggle.setAttribute("aria-expanded", "true");

    const firstNavLink = siteNav.querySelector("a");
    if (firstNavLink) {
      firstNavLink.focus();
    }
  };

  const syncMenuWithViewport = () => {
    if (!mobileNavBreakpoint.matches) {
      closeMenu();
    }
  };

  siteHeader.dataset.navOpen = "false";
  navToggle.setAttribute("aria-expanded", "false");

  navToggle.addEventListener("click", () => {
    const isOpen = siteHeader.dataset.navOpen === "true";

    if (isOpen) {
      closeMenu();
      return;
    }

    openMenu();
  });

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      if (!mobileNavBreakpoint.matches) {
        return;
      }

      closeMenu();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || siteHeader.dataset.navOpen !== "true") {
      return;
    }

    closeMenu({ returnFocus: true });
  });

  window.addEventListener("resize", syncMenuWithViewport);
  syncMenuWithViewport();
}
