document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');
    const errorMessage = document.getElementById('errorMessage');
    const emailInput = document.getElementById('email');
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let isSubmitting = false;

    emailInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[<>"']/g, '');
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isSubmitting) return;

        const email = emailInput.value.trim();
        errorMessage.classList.remove('show');
        errorMessage.textContent = '';

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

        isSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account...';

        try {
            // Registration uses the same endpoint as login (email-only auth)
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include',
                body: JSON.stringify({ email: email.toLowerCase() })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 150);
            } else {
                errorMessage.textContent = data.error || 'Registration failed. Please try again.';
                errorMessage.classList.add('show');
            }
        } catch (error) {
            console.error('Register error:', error);
            errorMessage.textContent = 'Network error. Please check your connection and try again.';
            errorMessage.classList.add('show');
        } finally {
            isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
        }
    });

emailInput.addEventListener('focus', () => {
        errorMessage.classList.remove('show');
    });
});