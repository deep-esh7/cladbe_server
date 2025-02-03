const FetchEmployeeData = require('../../tataCalling/tataCallingHelpers/fetchEmployeeData'); // Adjust path as needed

class NotificationHelpers {
    constructor() {
        this.employeeDataFetcher = new FetchEmployeeData();
    }

    async getDevicesTokens(companyId, empId) {
        try {
            const employeeData = await this.employeeDataFetcher.fetchEmployeeData(companyId, empId, true);
            
            // Check if we got an error string response
            if (typeof employeeData === 'string') {
                console.log('Failed to fetch employee data:', employeeData);
                return [];
            }

            const deviceTokensData = employeeData.deviceTokens;
            
            if (!deviceTokensData) {
                console.log('No device tokens found for employee');
                return [];
            }
            
            // Convert object values to array more concisely using Object.values
            const deviceTokens = Object.values(deviceTokensData);
            
            console.log('Device tokens:', deviceTokens);
            return deviceTokens;
            
        } catch (error) {
            console.error('Error fetching device tokens:', error);
            throw error; // Re-throw to handle in calling function
        }
    }
}

module.exports = NotificationHelpers;