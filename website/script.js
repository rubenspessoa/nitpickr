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

document.documentElement.classList.add("has-js");

const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.getElementById("site-nav");
const mobileNavBreakpoint = window.matchMedia("(max-width: 720px)");

if (siteHeader && navToggle && siteNav) {
  const navLinks = siteNav.querySelectorAll("a");

  const setMenuState = ({
    open,
    returnFocus = false,
    focusFirstLink = false,
  }) => {
    const isMobileViewport = mobileNavBreakpoint.matches;

    siteHeader.dataset.navOpen = open ? "true" : "false";
    navToggle.setAttribute("aria-expanded", String(open));
    siteNav.setAttribute(
      "aria-hidden",
      String(isMobileViewport ? !open : false),
    );

    if (open && focusFirstLink) {
      const firstNavLink = siteNav.querySelector("a");
      if (firstNavLink) {
        firstNavLink.focus({ preventScroll: true });
      }
    }

    if (returnFocus) {
      navToggle.focus();
    }
  };

  const closeMenu = ({ returnFocus = false } = {}) => {
    setMenuState({ open: false, returnFocus });
  };

  const openMenu = () => {
    setMenuState({ open: true, focusFirstLink: true });
  };

  const syncMenuWithViewport = () => {
    if (!mobileNavBreakpoint.matches) {
      closeMenu();
      return;
    }

    setMenuState({ open: siteHeader.dataset.navOpen === "true" });
  };

  setMenuState({ open: false });

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
  mobileNavBreakpoint.addEventListener("change", syncMenuWithViewport);
  syncMenuWithViewport();
}
