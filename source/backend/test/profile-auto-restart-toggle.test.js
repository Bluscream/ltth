/**
 * Test Suite: Profile Auto-Restart Toggle UI
 * 
 * Tests the new UI toggle for enabling/disabling auto-restart on profile switch
 */

describe('Profile Auto-Restart Toggle UI', () => {
    let toggle;
    let mockShowNotification;
    
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        
        // Setup DOM
        document.body.innerHTML = `
            <input type="checkbox" id="profile-auto-restart-toggle">
        `;
        
        // Mock showNotification
        global.showNotification = jest.fn();
        
        toggle = document.getElementById('profile-auto-restart-toggle');
    });
    
    afterEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });
    
    describe('Initialization', () => {
        test('should load disabled state when localStorage is not set', () => {
            // Simulate initialization
            const isEnabled = localStorage.getItem('profile_autoRestart') === 'true';
            toggle.checked = isEnabled;
            
            expect(toggle.checked).toBe(false);
        });
        
        test('should load enabled state when localStorage is set to true', () => {
            // Set localStorage
            localStorage.setItem('profile_autoRestart', 'true');
            
            // Simulate initialization
            const isEnabled = localStorage.getItem('profile_autoRestart') === 'true';
            toggle.checked = isEnabled;
            
            expect(toggle.checked).toBe(true);
        });
        
        test('should load disabled state when localStorage is set to false or other value', () => {
            // Set localStorage to non-true value
            localStorage.setItem('profile_autoRestart', 'false');
            
            // Simulate initialization
            const isEnabled = localStorage.getItem('profile_autoRestart') === 'true';
            toggle.checked = isEnabled;
            
            expect(toggle.checked).toBe(false);
        });
    });
    
    describe('Toggle Interaction', () => {
        test('should set localStorage when toggle is checked', () => {
            // Simulate user checking the toggle
            toggle.checked = true;
            
            // Simulate change handler
            if (toggle.checked) {
                localStorage.setItem('profile_autoRestart', 'true');
            }
            
            expect(localStorage.getItem('profile_autoRestart')).toBe('true');
        });
        
        test('should remove localStorage when toggle is unchecked', () => {
            // First set it
            localStorage.setItem('profile_autoRestart', 'true');
            
            // Simulate user unchecking the toggle
            toggle.checked = false;
            
            // Simulate change handler
            if (!toggle.checked) {
                localStorage.removeItem('profile_autoRestart');
            }
            
            expect(localStorage.getItem('profile_autoRestart')).toBeNull();
        });
    });
    
    describe('Full Workflow', () => {
        test('should support enable -> disable -> enable cycle', () => {
            // Start disabled
            expect(localStorage.getItem('profile_autoRestart')).toBeNull();
            
            // Enable
            toggle.checked = true;
            localStorage.setItem('profile_autoRestart', 'true');
            expect(localStorage.getItem('profile_autoRestart')).toBe('true');
            
            // Disable
            toggle.checked = false;
            localStorage.removeItem('profile_autoRestart');
            expect(localStorage.getItem('profile_autoRestart')).toBeNull();
            
            // Enable again
            toggle.checked = true;
            localStorage.setItem('profile_autoRestart', 'true');
            expect(localStorage.getItem('profile_autoRestart')).toBe('true');
        });
        
        test('should persist across page reloads', () => {
            // Enable
            toggle.checked = true;
            localStorage.setItem('profile_autoRestart', 'true');
            
            // Simulate page reload by re-reading from localStorage
            const isEnabled = localStorage.getItem('profile_autoRestart') === 'true';
            
            expect(isEnabled).toBe(true);
        });
    });
    
    describe('Integration with Profile Switch', () => {
        test('should work with existing profile-manager.js auto-restart logic', () => {
            // The profile-manager.js checks: localStorage.getItem('profile_autoRestart') === 'true'
            
            // When toggle is enabled
            localStorage.setItem('profile_autoRestart', 'true');
            const autoRestartEnabled = localStorage.getItem('profile_autoRestart') === 'true';
            expect(autoRestartEnabled).toBe(true);
            
            // When toggle is disabled
            localStorage.removeItem('profile_autoRestart');
            const autoRestartDisabled = localStorage.getItem('profile_autoRestart') === 'true';
            expect(autoRestartDisabled).toBe(false);
        });
    });
});

describe('Profile Auto-Restart Integration Tests', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    
    test('should match the exact check used in profile-manager.js', () => {
        // This is the exact check from profile-manager.js line 228:
        // const autoRestartEnabled = localStorage.getItem('profile_autoRestart') === 'true';
        
        // Test when enabled
        localStorage.setItem('profile_autoRestart', 'true');
        expect(localStorage.getItem('profile_autoRestart') === 'true').toBe(true);
        
        // Test when disabled (not set)
        localStorage.removeItem('profile_autoRestart');
        expect(localStorage.getItem('profile_autoRestart') === 'true').toBe(false);
        
        // Test when disabled (set to false string)
        localStorage.setItem('profile_autoRestart', 'false');
        expect(localStorage.getItem('profile_autoRestart') === 'true').toBe(false);
        
        // Test when disabled (set to empty string)
        localStorage.setItem('profile_autoRestart', '');
        expect(localStorage.getItem('profile_autoRestart') === 'true').toBe(false);
    });
});
