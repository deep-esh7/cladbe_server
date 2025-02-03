const db = require("../../src/admin").firestore();

class EmployeeHelper {
  constructor() {
    if (!EmployeeHelper.instance) {
      EmployeeHelper.instance = this;
    }
    return EmployeeHelper.instance;
  }

  async fetchEmployeeDataByNumber(companyID, phoneNumber) {
    try {
      console.log(
        `Fetching employee data for phone number: ${phoneNumber} in company: ${companyID}`
      );

      const snapshot = await db
        .collection("Companies")
        .doc(companyID)
        .collection("Employees")
        .where("phoneNumber", "==", phoneNumber)
        .get();

      if (snapshot.empty) {
        console.log(`No employee found with phone number: ${phoneNumber}`);
        return "Employee Not Found";
      }

      const doc = snapshot.docs[0];
      const employeeData = doc.data();

      const response = {
        number: employeeData.phoneNumber,
        designation: employeeData.designation,
        id: employeeData.id,
        name: employeeData.name,
        phoneNumber: employeeData.phoneNumber,
      };

      console.log(`Found employee data:`, response);
      return response;
    } catch (error) {
      console.error("Error fetching employee by phone number:", {
        error: error.message,
        stack: error.stack,
        companyID,
        phoneNumber,
      });
      return "Employee Not Found";
    }
  }

  async fetchEmployeeData(companyID, employeeID, fullDetails) {
    try {
      if (!companyID || typeof companyID !== "string") {
        throw new Error("Invalid company ID");
      }

      if (!employeeID || employeeID === "") {
        console.log("Empty or invalid employee ID provided");
        return "Employee Not Found";
      }

      const shouldFetchFullDetails = Boolean(fullDetails);
      console.log(
        `Fetching ${
          shouldFetchFullDetails ? "full" : "basic"
        } details for employee:`,
        employeeID
      );

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
          console.log(
            `Found available employee with phone: ${employeeData.phoneNumber}`
          );
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

      console.log(
        `Successfully fetched full details for employee ${employeeID}:`,
        response
      );
      return response;
    } catch (error) {
      console.error("Error fetching employee data:", {
        error: error.message,
        stack: error.stack,
        companyID,
        employeeID,
        fullDetails,
      });
      return "Employee Not Found";
    }
  }

  // Helper method for circular rotation
  circularRotateOneStep(arr) {
    if (!arr || arr.length <= 1) return arr;
    return [...arr.slice(1), arr[0]];
  }

  async updateEmployeeListToDB(
    routing,
    companyId,
    conditionID,
    listOfEmployees
  ) {
    try {
      if (!listOfEmployees || listOfEmployees.length === 0) {
        console.log("No employees to rotate");
        return;
      }

      let rotatedEmployeesList;

      if (routing === "Round Robin (1 by 1)") {
        rotatedEmployeesList = this.circularRotateOneStep(listOfEmployees);
        console.log("One step rotation result:", rotatedEmployeesList);
      } else if (routing === "Round Robin (Simultaneous)") {
        const middleIndex = Math.floor(listOfEmployees.length / 2);
        const firstHalf = listOfEmployees.slice(0, middleIndex);
        const secondHalf = listOfEmployees.slice(middleIndex);

        const rotatedFirstHalf = this.circularRotateOneStep(firstHalf);
        const rotatedSecondHalf = this.circularRotateOneStep(secondHalf);

        rotatedEmployeesList = [];
        for (
          let i = 0;
          i < Math.max(rotatedFirstHalf.length, rotatedSecondHalf.length);
          i++
        ) {
          if (i < rotatedFirstHalf.length) {
            rotatedEmployeesList.push(rotatedFirstHalf[i]);
          }
          if (i < rotatedSecondHalf.length) {
            rotatedEmployeesList.push(rotatedSecondHalf[i]);
          }
        }

        console.log("Original list:", listOfEmployees);
        console.log("Rotated list:", rotatedEmployeesList);
      }

      await db
        .collection("Companies")
        .doc(companyId)
        .collection("conversations")
        .doc("telephony")
        .collection("telephony")
        .doc("conditions")
        .collection("conditions")
        .doc(conditionID)
        .update({
          employeeList: rotatedEmployeesList,
        });

      console.log("List updated successfully in database");
      return rotatedEmployeesList;
    } catch (error) {
      console.error("Error updating employee list:", {
        error: error.message,
        stack: error.stack,
        companyId,
        conditionID,
        routing,
      });
      throw error;
    }
  }
}

// Create and export singleton instance
const employeeHelper = new EmployeeHelper();
module.exports = employeeHelper;
