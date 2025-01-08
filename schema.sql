CREATE SCHEMA IF NOT EXISTS company_data;

-- Switch to the new schema
SET search_path TO company_data;

-- Create a table
CREATE TABLE IF NOT EXISTS employees (
    employee_id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    hire_date DATE NOT NULL,
    job_title VARCHAR(100)
);

-- Insert data into the table
INSERT INTO employees (first_name, last_name, email, hire_date, job_title)
VALUES
    ('John', 'Doe', 'john.doe@example.com', '2024-01-15', 'Software Engineer'),
    ('Jane', 'Smith', 'jane.smith@example.com', '2023-09-23', 'Project Manager'),
    ('Michael', 'Johnson', 'michael.j@example.com', '2022-05-30', 'Data Analyst');

-- Query to check data
SELECT * FROM employees;
