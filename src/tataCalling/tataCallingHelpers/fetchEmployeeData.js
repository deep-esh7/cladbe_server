const db = require('../../admin').firestore();

class FetchEmployeeData {
    async fetchEmployeeData(companyID, employeeID, fullDetails) {
        // Input validation
        if (!companyID || typeof companyID !== 'string') {
            throw new Error('Invalid company ID');
        }
        
        if (!employeeID || employeeID === "") {
            return "Employee Not Found";
        }

        // Convert fullDetails to boolean if it's not already
        const shouldFetchFullDetails = Boolean(fullDetails);

        console.log(`Fetching ${shouldFetchFullDetails ? 'full' : 'basic'} details for employee:`, employeeID);

        try {
            const snapshot = await db
                .collection("Companies")
                .doc(companyID)
                .collection("Employees")
                .where("id", "==", employeeID)
                .get();

            if (snapshot.empty) {
                console.log(`No employee found with ID: ${employeeID}`);
                return "Employee Not Found";
            }

            const doc = snapshot.docs[0];
            const employeeData = doc.data();

            if (!shouldFetchFullDetails) {
                if (employeeData.status === "available") {
                    console.log(`Found available employee with phone: ${employeeData.phoneNumber}`);
                    return employeeData.phoneNumber;
                }
                console.log(`Employee ${employeeID} is busy`);
                return "Agent Is Busy";
            }

            const response = {
                number: employeeData.phoneNumber,
                designation: employeeData.designation,
                id: employeeData.id,
                name: employeeData.name,
                phoneNumber: employeeData.phoneNumber,
                deviceTokens: employeeData.deviceTokens,
            };

            console.log(`Successfully fetched full details for employee ${employeeID}`);
            return response;

        } catch (error) {
            console.error(`Error fetching employee data for ${employeeID}:`, error);
            return "Employee Not Found";
        }
    }
}

module.exports = FetchEmployeeData;