document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const emailInput = document.getElementById('email');
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    
    let attemptCount = 0;
    const MAX_ATTEMPTS = 5;
    let isSubmitting = false;

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Input sanitization
    emailInput.addEventListener('input', (e) => {
        // Remove any potentially dangerous characters
        e.target.value = e.target.value.replace(/[<>\"']/g, '');
    });

    // Prevent form submission spam
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (isSubmitting) {
            return; // Prevent double submission
        }

        const email = emailInput.value.trim();
        errorMessage.classList.remove('show');
        errorMessage.textContent = '';

        // Client-side validation
        if (!email) {
            errorMessage.textContent = 'Please enter your email address';
            errorMessage.classList.add('show');
            emailInput.focus();
            return;
        }

        if (!emailRegex.test(email)) {
            errorMessage.textContent = 'Please enter a valid email address';
            errorMessage.classList.add('show');
            emailInput.focus();
            return;
        }

        if (email.length > 100) {
            errorMessage.textContent = 'Email address is too long';
            errorMessage.classList.add('show');
            return;
        }

        // Disable submit button to prevent spam
        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in...';

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest' // CSRF protection header
                },
                credentials: 'include', // Include cookies
                body: JSON.stringify({ email: email.toLowerCase() })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Clear form
                emailInput.value = '';
                // Redirect after short delay
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 100);
            } else {
                attemptCount++;
                const errorText = data.error || 'Login failed. Please try again.';
                errorMessage.textContent = errorText;
                errorMessage.classList.add('show');
                
                if (attemptCount >= MAX_ATTEMPTS) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Too many attempts';
                    setTimeout(() => {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Login';
                        attemptCount = 0;
                    }, 60000); // 1 minute cooldown
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            errorMessage.textContent = 'Network error. Please check your connection and try again.';
            errorMessage.classList.add('show');
        } finally {
            isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Login';
        }
    });

    // Clear error on input
    emailInput.addEventListener('focus', () => {
        errorMessage.classList.remove('show');
    });
});

