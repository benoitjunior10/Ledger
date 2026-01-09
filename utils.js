const Joi = require('joi');

// validation creation wallet
const createWalletSchema = Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    phoneNumber: Joi.string().pattern(/^\+509\d{8}$/).required(),
    dateOfBirth: Joi.date().less('now').required(), 
    nationalId: Joi.string().required(),
    pin: Joi.string().length(4).pattern(/^\d+$/).required() // 4 chiffres 
});

// Calcul l'age (16 ans min)
const isAdult = (dobString) => {
    const dob = new Date(dobString);
    const ageDifMs = Date.now() - dob.getTime();
    const ageDate = new Date(ageDifMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970) >= 16;
};

module.exports = { createWalletSchema, isAdult };