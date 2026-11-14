// Keeps links to other applications from opening them on the machine that runs the tests.
document.addEventListener("click", (event) => {
	if (event.target instanceof Element && event.target.closest('a[href^="mailto:"], a[href^="tel:"]')) {
		event.preventDefault();
	}
});
