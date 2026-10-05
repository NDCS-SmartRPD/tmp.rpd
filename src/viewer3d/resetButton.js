import { getAppBasePath } from "../js/shared/pageContext.js";

export function addResetButton(camera, clone, controls, getResetTarget = null) {
    let rotationLocked = true; // Initial state of rotation lock
    const getViewerRightNav = () => {
        if (window.getViewerRightNav) return window.getViewerRightNav();
        let nav = document.getElementById('viewer-right-nav');
        if (!nav) {
            nav = document.createElement('nav');
            nav.id = 'viewer-right-nav';
            nav.setAttribute('aria-label', 'Viewer controls');
            document.body.appendChild(nav);
        }
        return nav;
    };

    // Create and append styles
    const style = document.createElement('style');
    style.innerHTML = `
        /* Animation for rotating the reset icon */
        @keyframes rotate360 {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Styles for the reset button */
        #reset-button {
            position: static;
            order: 20;
            z-index: 1000;
            background: transparent;
            border: 0;
            padding: 0;
            color: #ffffff;
            font-family: Arial, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            /* Size comes from --toolbar-btn-size, set per breakpoint by index.js.
               Two <style> tags hardcoding a width here tied on specificity and
               were decided by script load order; a variable leaves one winner. */
            width: var(--toolbar-btn-size, 46px);
            height: var(--toolbar-btn-size, 46px);
            box-shadow: none;
            transition: filter 0.2s, transform 0.2s;
        }

        /* Highlight on hover */
        #reset-button:hover {
            filter: brightness(1.15);
            transform: scale(1.06);
        }

        /* Styles for the reset icon */
        #reset-icon {
            width: 30px;
            height: 30px;
            margin-right: 0;
            filter: brightness(0) invert(1);
            transition: transform 0.1s;
        }

        /* Rotate animation when clicked */
        #reset-button.clicked #reset-icon {
            animation: rotate360 0.5s linear;
        }

        /* Styles for the lock rotation button */
        #lock-rotation-button {
            position: static;
            order: 30;
            z-index: 1000;
            background: transparent;
            border: 0;
            padding: 0;
            color: #ffffff;
            font-family: Arial, sans-serif;
            cursor: pointer;
            /* See #reset-button above — same single-source-of-truth variable. */
            width: var(--toolbar-btn-size, 46px);
            height: var(--toolbar-btn-size, 46px);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: none;
            transition: filter 0.2s, transform 0.2s;
        }

        /* Highlight on hover */
        #lock-rotation-button:hover {
            filter: brightness(1.15);
            transform: scale(1.06);
        }

        /* Sized here, not inline, so index.js's breakpoints can grow it with
           the toolbar's other icons — same as #reset-icon. */
        #lock-icon {
            width: 30px;
            height: 30px;
            filter: brightness(0) invert(1);
        }
    `;
    document.head.appendChild(style);

    // Create the reset button
    const resetButton = document.createElement('button');
    resetButton.id = 'reset-button';

    // Create the icon
    const resetIcon = document.createElement('img');
    const basePath = getAppBasePath();
    resetIcon.src = `${basePath}/assets/reset.png`; // Replace with the path to your icon
    // resetIcon.src = '/reset.png'; // Replace with the path to your icon
    resetIcon.alt = 'Reset';
    resetIcon.id = 'reset-icon';

    // Append the icon to the button (no text label)
    resetButton.appendChild(resetIcon);

    // Wrap reset + lock buttons in a shared row so they sit side by side
    const topRow = document.createElement('div');
    topRow.id = 'viewer-right-nav-top-row';
    // Shares the nav toolbar row with the design/upload buttons.
    (window.getViewerNavToolbar?.() || getViewerRightNav()).appendChild(topRow);
    topRow.appendChild(resetButton);

    // Function to handle reset button click
    function handleResetButtonClick() {
        // Add class to trigger animation
        resetButton.classList.add('clicked');
        // `false` = non-recursive: a recursive copy would re-clone the camera's
        // child lights on every click, additively brightening the scene.
        camera.copy(clone, false)
        // Reset the camera zoom
        camera.zoom = 7;
        camera.updateProjectionMatrix();
        // Reset controls target and update controls
        const resetTarget = typeof getResetTarget === 'function' ? getResetTarget() : null;
        if (resetTarget) {
            controls.target.copy(resetTarget);
        } else {
            controls.target.set(0, 0, 0);
        }
        controls.update();

        // Reset animation after delay
        setTimeout(() => {
            resetButton.classList.remove('clicked');
        }, 1000); // Adjust timing as needed

        // Add your reset logic here if needed
        //console.log('Reset button clicked');
    }

    // Add click event listener to reset button
    resetButton.addEventListener('click', handleResetButtonClick);

    // Create the lock rotation button
    const lockRotationButton = document.createElement('button');
    lockRotationButton.id = 'lock-rotation-button';

    // Initial setup for the button's background image and text
    updateLockRotationButtonImage();

    // Starts in the same top row as reset, same as before — but newControls.js's
    // Show/Hide panel adopts this exact node into its header as soon as it first
    // builds (see createComponentPanel), so in practice this only holds the
    // button for the instant before that panel exists. Built here rather than
    // there because the locked/unlocked state below needs to survive that panel
    // being torn down and rebuilt on every case/view switch.
    topRow.appendChild(lockRotationButton);

    // Define the lock/unlock rotation function
    function toggleRotationLock() {
        rotationLocked = !rotationLocked; // Toggle rotation lock state
        updateLockRotationButtonImage(); // Update button image
        // Implement your logic to lock or unlock rotation
        controls.noRotate = rotationLocked;
        //console.log(`Rotation ${rotationLocked ? 'locked' : 'unlocked'}`);
    }

    // Add a listener to the lock rotation button
    lockRotationButton.addEventListener('click', toggleRotationLock);
    lockRotationButton.click();

    // Function to update lock rotation button image based on current state
    function updateLockRotationButtonImage() {
        const basePath = getAppBasePath();

        const lockedImageUrl = `${basePath}/assets/lock.png`;    // Replace with your locked image path
        const unlockedImageUrl = `${basePath}/assets/unlock.png`;
 // Replace with your unlocked image path
        const imageUrl = rotationLocked ? lockedImageUrl : unlockedImageUrl;

        // Clear existing content
        lockRotationButton.innerHTML = '';

        // Create an image element
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = rotationLocked ? 'Locked' : 'Unlocked';
        // Sized via #lock-icon in this file's <style> block: inline width/height
        // would beat every breakpoint override, as with #reset-icon.
        img.id = 'lock-icon';

        // Append the icon only (no text label)
        lockRotationButton.appendChild(img);
    }
}
